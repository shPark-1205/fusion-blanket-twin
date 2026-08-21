"""Case identity, scalar-result ingestion, and registry validation."""

from __future__ import annotations

from dataclasses import dataclass, replace
from pathlib import Path
import csv
import json
import re
import zipfile
import xml.etree.ElementTree as ET

from fusion_blanket_twin.geometry.csg import PrimitiveCSGParameters
from fusion_blanket_twin.mcnp.csg_parser import parse_primitive_csg_parameters


PZ_CASE_NUMBERS: tuple[int, ...] = tuple(range(104, 114))
CZ_LABELS: tuple[str, ...] = ("A", "B", "C", "D", "E", "Base", "F", "G", "H", "I")
CZ_ORDER: dict[str, int] = {label: index for index, label in enumerate(CZ_LABELS)}

_CASE_FILENAME_RE = re.compile(
    r"^INDEX_(?P<pz_case>\d+)-(?P<cz_label>A|B|C|D|E|Base|F|G|H|I)\.inp$"
)
_EXCEL_NS = {
    "a": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
}


class CaseRegistryError(ValueError):
    """Base error for case registry validation failures."""


class DuplicateCaseError(CaseRegistryError):
    """Raised when two records share the same case ID."""


class MissingCaseCombinationError(CaseRegistryError):
    """Raised when the 10 by 10 DOE product is incomplete."""


class ScalarWorkbookError(CaseRegistryError):
    """Raised when scalar workbook data cannot be joined safely."""


@dataclass(frozen=True)
class CaseIdentity:
    case_id: str
    pz_case_number: int
    cz_label: str
    input_filename: str

    @property
    def sort_key(self) -> tuple[int, int]:
        return self.pz_case_number, CZ_ORDER[self.cz_label]


@dataclass(frozen=True)
class ScalarResults:
    total_tbr: float
    li6_tbr: float
    li7_tbr: float
    multiplying: float


@dataclass(frozen=True)
class CaseRecord:
    identity: CaseIdentity
    input_path: Path
    primitive_csg: PrimitiveCSGParameters
    total_tbr: float | None = None
    li6_tbr: float | None = None
    li7_tbr: float | None = None
    multiplying: float | None = None
    breeder_ratio: float | None = None
    step_path: Path | None = None
    adaptive_fmesh_path: Path | None = None
    canonical_fmesh_path: Path | None = None
    notes: str = ""
    status: str = "parsed"

    @property
    def case_id(self) -> str:
        return self.identity.case_id

    def with_scalar_results(self, results: ScalarResults) -> "CaseRecord":
        return replace(
            self,
            total_tbr=results.total_tbr,
            li6_tbr=results.li6_tbr,
            li7_tbr=results.li7_tbr,
            multiplying=results.multiplying,
            status="parsed_with_scalars",
        )

    def to_flat_dict(self) -> dict[str, object]:
        values: dict[str, object] = {
            "case_id": self.identity.case_id,
            "pz_case_number": self.identity.pz_case_number,
            "cz_label": self.identity.cz_label,
            "input_filename": self.identity.input_filename,
            "input_path": str(self.input_path),
            **self.primitive_csg.as_dict(),
            "total_tbr": self.total_tbr,
            "li6_tbr": self.li6_tbr,
            "li7_tbr": self.li7_tbr,
            "multiplying": self.multiplying,
            "breeder_ratio": self.breeder_ratio,
            "step_path": _path_to_str(self.step_path),
            "adaptive_fmesh_path": _path_to_str(self.adaptive_fmesh_path),
            "canonical_fmesh_path": _path_to_str(self.canonical_fmesh_path),
            "notes": self.notes,
            "status": self.status,
        }
        return values


@dataclass(frozen=True)
class CurrentDoeConstraintReport:
    pz_spacings_cm: tuple[float, float, float]
    cz_radial_spacings_cm: tuple[float, float, float]
    pz_spacing_constant: bool
    cz_spacing_constant: bool
    pz_independent_of_cz: bool
    cz_independent_of_pz: bool
    inconsistencies: tuple[str, ...]

    @property
    def is_consistent(self) -> bool:
        return not self.inconsistencies


class CaseRegistry:
    """Validated collection of MCNP cases keyed by explicit case identity."""

    def __init__(self, records: list[CaseRecord] | tuple[CaseRecord, ...]) -> None:
        sorted_records = tuple(sorted(records, key=lambda record: record.identity.sort_key))
        seen: dict[str, CaseRecord] = {}
        for record in sorted_records:
            if record.case_id in seen:
                raise DuplicateCaseError(f"duplicate case ID: {record.case_id}")
            seen[record.case_id] = record
        self._records = sorted_records
        self._by_case_id = seen

    @property
    def records(self) -> tuple[CaseRecord, ...]:
        return self._records

    @property
    def by_case_id(self) -> dict[str, CaseRecord]:
        return dict(self._by_case_id)

    def __len__(self) -> int:
        return len(self._records)

    @classmethod
    def from_input_directory(cls, input_dir: Path) -> "CaseRegistry":
        if not input_dir.exists():
            raise FileNotFoundError(f"MCNP input directory not found: {input_dir}")
        if not input_dir.is_dir():
            raise ValueError(f"MCNP input path is not a directory: {input_dir}")

        records = []
        for path in sorted(input_dir.glob("*.inp"), key=_case_path_sort_key):
            identity = parse_case_identity_from_filename(path.name)
            records.append(
                CaseRecord(
                    identity=identity,
                    input_path=path,
                    primitive_csg=parse_primitive_csg_parameters(path),
                )
            )
        registry = cls(records)
        registry.validate_complete_10x10()
        return registry

    def with_scalar_results(self, workbook_path: Path) -> "CaseRegistry":
        scalar_results = load_scalar_results_workbook(workbook_path)
        duplicate_or_missing = sorted(set(scalar_results) - set(self._by_case_id))
        if duplicate_or_missing:
            raise ScalarWorkbookError(
                "scalar workbook contains cases not present in registry: "
                + ", ".join(duplicate_or_missing)
            )

        missing = sorted(set(self._by_case_id) - set(scalar_results))
        if missing:
            raise ScalarWorkbookError(
                "scalar workbook is missing registry cases: " + ", ".join(missing)
            )

        return CaseRegistry(
            [
                record.with_scalar_results(scalar_results[record.case_id])
                for record in self._records
            ]
        )

    def validate_complete_10x10(self) -> None:
        if len(self._records) != 100:
            raise MissingCaseCombinationError(
                f"expected exactly 100 cases, found {len(self._records)}"
            )

        pz_cases = {record.identity.pz_case_number for record in self._records}
        cz_labels = {record.identity.cz_label for record in self._records}
        if pz_cases != set(PZ_CASE_NUMBERS):
            raise MissingCaseCombinationError(
                f"unexpected PZ case set: {sorted(pz_cases)}"
            )
        if cz_labels != set(CZ_LABELS):
            raise MissingCaseCombinationError(
                f"unexpected CZ label set: {sorted(cz_labels, key=_cz_sort_key)}"
            )

        expected = {
            f"{pz_case}-{cz_label}"
            for pz_case in PZ_CASE_NUMBERS
            for cz_label in CZ_LABELS
        }
        actual = set(self._by_case_id)
        missing = sorted(expected - actual, key=_case_id_sort_key)
        extra = sorted(actual - expected, key=_case_id_sort_key)
        if missing or extra:
            message_parts = []
            if missing:
                message_parts.append("missing: " + ", ".join(missing))
            if extra:
                message_parts.append("extra: " + ", ".join(extra))
            raise MissingCaseCombinationError("; ".join(message_parts))

    def validate_current_doe_constraints(self, tolerance: float = 1.0e-9) -> CurrentDoeConstraintReport:
        inconsistencies: list[str] = []
        first = self._records[0].primitive_csg
        expected_pz_spacings = first.pz_spacings_cm
        expected_cz_spacings = first.cz_radial_spacings_cm

        pz_spacing_constant = True
        cz_spacing_constant = True
        for record in self._records:
            if not _tuples_close(record.primitive_csg.pz_spacings_cm, expected_pz_spacings, tolerance):
                pz_spacing_constant = False
                inconsistencies.append(f"{record.case_id}: PZ spacings changed")
            if not _tuples_close(record.primitive_csg.cz_radial_spacings_cm, expected_cz_spacings, tolerance):
                cz_spacing_constant = False
                inconsistencies.append(f"{record.case_id}: CZ radial spacings changed")

        pz_independent = True
        for pz_case in PZ_CASE_NUMBERS:
            group = [r for r in self._records if r.identity.pz_case_number == pz_case]
            reference = _pz_tuple(group[0].primitive_csg)
            for record in group[1:]:
                if not _tuples_close(_pz_tuple(record.primitive_csg), reference, tolerance):
                    pz_independent = False
                    inconsistencies.append(
                        f"{record.case_id}: PZ values depend on CZ label"
                    )

        cz_independent = True
        for cz_label in CZ_LABELS:
            group = [r for r in self._records if r.identity.cz_label == cz_label]
            reference = _cz_tuple(group[0].primitive_csg)
            for record in group[1:]:
                if not _tuples_close(_cz_tuple(record.primitive_csg), reference, tolerance):
                    cz_independent = False
                    inconsistencies.append(
                        f"{record.case_id}: CZ values depend on PZ case"
                    )

        return CurrentDoeConstraintReport(
            pz_spacings_cm=expected_pz_spacings,
            cz_radial_spacings_cm=expected_cz_spacings,
            pz_spacing_constant=pz_spacing_constant,
            cz_spacing_constant=cz_spacing_constant,
            pz_independent_of_cz=pz_independent,
            cz_independent_of_pz=cz_independent,
            inconsistencies=tuple(inconsistencies),
        )

    def export_csv(self, path: Path) -> None:
        rows = [record.to_flat_dict() for record in self._records]
        if not rows:
            raise CaseRegistryError("cannot export an empty registry")
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("w", newline="", encoding="utf-8") as stream:
            writer = csv.DictWriter(stream, fieldnames=list(rows[0]))
            writer.writeheader()
            writer.writerows(rows)

    def export_json(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("w", encoding="utf-8") as stream:
            json.dump([record.to_flat_dict() for record in self._records], stream, indent=2)


def parse_case_identity_from_filename(filename: str) -> CaseIdentity:
    match = _CASE_FILENAME_RE.match(Path(filename).name)
    if match is None:
        raise ValueError(f"invalid MCNP case filename: {filename}")

    pz_case_number = int(match.group("pz_case"))
    cz_label = match.group("cz_label")
    if pz_case_number not in PZ_CASE_NUMBERS:
        raise ValueError(f"unexpected PZ case number in filename: {filename}")
    if cz_label not in CZ_ORDER:
        raise ValueError(f"unexpected CZ label in filename: {filename}")

    return CaseIdentity(
        case_id=f"{pz_case_number}-{cz_label}",
        pz_case_number=pz_case_number,
        cz_label=cz_label,
        input_filename=Path(filename).name,
    )


def sorted_cz_labels(labels: list[str] | tuple[str, ...]) -> list[str]:
    return sorted(labels, key=_cz_sort_key)


def load_scalar_results_workbook(path: Path) -> dict[str, ScalarResults]:
    if not path.exists():
        raise FileNotFoundError(f"scalar workbook not found: {path}")
    if not path.is_file():
        raise ValueError(f"scalar workbook path is not a file: {path}")

    rows = _read_xlsx_sheet_rows(path, "Case_Registry")
    if not rows:
        raise ScalarWorkbookError("Case_Registry sheet is empty")

    headers = [_normalize_header(str(value)) for value in rows[0]]
    required_headers = {
        "case_id": "Case ID",
        "pz_case": "PZ Case",
        "cz_case": "CZ Case",
        "total_tbr": "Total TBR",
        "li6_tbr": "Li6 TBR",
        "li7_tbr": "Li7 TBR",
        "multiplying": "Multiplying",
    }
    header_index = {}
    for key, label in required_headers.items():
        normalized = _normalize_header(label)
        if normalized not in headers:
            raise ScalarWorkbookError(f"Case_Registry missing required column: {label}")
        header_index[key] = headers.index(normalized)

    results: dict[str, ScalarResults] = {}
    for row_number, row in enumerate(rows[1:], start=2):
        if not any(value not in ("", None) for value in row):
            continue
        case_id = str(_cell_at(row, header_index["case_id"])).strip()
        if not case_id:
            continue
        if case_id in results:
            raise ScalarWorkbookError(f"duplicate scalar record for case {case_id}")

        pz_case = int(float(_cell_at(row, header_index["pz_case"])))
        cz_label = str(_cell_at(row, header_index["cz_case"])).strip()
        expected_identity = parse_case_identity_from_filename(f"INDEX_{case_id}.inp")
        if expected_identity.pz_case_number != pz_case or expected_identity.cz_label != cz_label:
            raise ScalarWorkbookError(
                f"row {row_number}: case ID {case_id} does not match "
                f"PZ/CZ coordinates {pz_case}-{cz_label}"
            )

        results[case_id] = ScalarResults(
            total_tbr=_required_float(row, header_index["total_tbr"], case_id, "Total TBR"),
            li6_tbr=_required_float(row, header_index["li6_tbr"], case_id, "Li6 TBR"),
            li7_tbr=_required_float(row, header_index["li7_tbr"], case_id, "Li7 TBR"),
            multiplying=_required_float(
                row, header_index["multiplying"], case_id, "Multiplying"
            ),
        )

    return results


def _read_xlsx_sheet_rows(path: Path, sheet_name: str) -> list[list[object]]:
    with zipfile.ZipFile(path) as archive:
        shared_strings = _read_shared_strings(archive)
        sheet_path = _sheet_path_for_name(archive, sheet_name)
        root = ET.fromstring(archive.read(sheet_path))

    rows: list[list[object]] = []
    for row in root.findall(".//a:sheetData/a:row", _EXCEL_NS):
        cells_by_col: dict[int, object] = {}
        for cell in row.findall("a:c", _EXCEL_NS):
            ref = cell.attrib.get("r", "")
            col_index = _column_index_from_cell_ref(ref)
            cells_by_col[col_index] = _read_cell_value(cell, shared_strings)
        if cells_by_col:
            rows.append(
                [cells_by_col.get(index, "") for index in range(max(cells_by_col) + 1)]
            )
    return rows


def _read_shared_strings(archive: zipfile.ZipFile) -> list[str]:
    if "xl/sharedStrings.xml" not in archive.namelist():
        return []
    root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
    return [
        "".join(text.text or "" for text in item.findall(".//a:t", _EXCEL_NS))
        for item in root.findall("a:si", _EXCEL_NS)
    ]


def _sheet_path_for_name(archive: zipfile.ZipFile, sheet_name: str) -> str:
    workbook = ET.fromstring(archive.read("xl/workbook.xml"))
    relationships = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
    targets = {
        rel.attrib["Id"]: rel.attrib["Target"]
        for rel in relationships
    }
    for sheet in workbook.findall(".//a:sheets/a:sheet", _EXCEL_NS):
        if sheet.attrib["name"] != sheet_name:
            continue
        relationship_id = sheet.attrib[
            "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
        ]
        target = targets[relationship_id]
        return target if target.startswith("xl/") else f"xl/{target}"
    raise ScalarWorkbookError(f"workbook sheet not found: {sheet_name}")


def _read_cell_value(cell: ET.Element, shared_strings: list[str]) -> object:
    value = cell.find("a:v", _EXCEL_NS)
    if value is None or value.text is None:
        inline = cell.find("a:is/a:t", _EXCEL_NS)
        return "" if inline is None or inline.text is None else inline.text

    raw = value.text
    if cell.attrib.get("t") == "s":
        return shared_strings[int(raw)]
    if cell.attrib.get("t") == "str":
        return raw
    try:
        numeric = float(raw)
    except ValueError:
        return raw
    return int(numeric) if numeric.is_integer() else numeric


def _column_index_from_cell_ref(ref: str) -> int:
    letters = "".join(ch for ch in ref if ch.isalpha())
    index = 0
    for char in letters:
        index = index * 26 + (ord(char.upper()) - ord("A") + 1)
    return index - 1


def _normalize_header(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", value.strip().lower()).strip("_")


def _cell_at(row: list[object], index: int) -> object:
    return row[index] if index < len(row) else ""


def _required_float(row: list[object], index: int, case_id: str, label: str) -> float:
    value = _cell_at(row, index)
    if value in ("", None):
        raise ScalarWorkbookError(f"case {case_id} missing {label}")
    try:
        return float(value)
    except (TypeError, ValueError) as exc:
        raise ScalarWorkbookError(
            f"case {case_id} has non-numeric {label}: {value!r}"
        ) from exc


def _case_path_sort_key(path: Path) -> tuple[int, int]:
    return parse_case_identity_from_filename(path.name).sort_key


def _case_id_sort_key(case_id: str) -> tuple[int, int]:
    pz_case, cz_label = case_id.split("-", 1)
    return int(pz_case), _cz_sort_key(cz_label)


def _cz_sort_key(label: str) -> int:
    try:
        return CZ_ORDER[label]
    except KeyError as exc:
        raise ValueError(f"unknown CZ label: {label}") from exc


def _path_to_str(path: Path | None) -> str | None:
    return None if path is None else str(path)


def _pz_tuple(params: PrimitiveCSGParameters) -> tuple[float, float, float, float]:
    return params.pz_206, params.pz_207, params.pz_208, params.pz_209


def _cz_tuple(params: PrimitiveCSGParameters) -> tuple[float, float, float, float]:
    return (
        params.cz_301_radius,
        params.cz_302_radius,
        params.cz_303_radius,
        params.cz_304_radius,
    )


def _tuples_close(
    left: tuple[float, ...],
    right: tuple[float, ...],
    tolerance: float,
) -> bool:
    return all(abs(a - b) <= tolerance for a, b in zip(left, right))
