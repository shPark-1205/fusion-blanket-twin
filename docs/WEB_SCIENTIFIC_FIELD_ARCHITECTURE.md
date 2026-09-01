# Web scientific-field architecture spike

## vtk.js capability check

The current application does not install vtk.js. The current published vtk.js package checked for this spike was 36.10.0. Its public reader exports do not include a VTKHDF reader or a concrete XML UnstructuredGrid (`.vtu`) reader. `vtkHttpDataSetReader` can load vtk.js JSON metadata with binary array payloads, including cell data. vtk.js provides `vtkImageData`, scalar mapping, scalar-bar actors, and GPU cutting APIs, but those capabilities do not make a nonuniform rectilinear MCNP grid into uniform image data.

The source mesh is a VTK unstructured grid, but inspection shows that this case is exactly a complete Cartesian product of 147 × 147 × 56 points and 146 × 146 × 55 axis-aligned VTK voxel cells. X and Y spacing are uniform; Z spacing is not. This supports an exact rectilinear representation, not a uniform `vtkImageData` approximation.

Official capability references used for the check: [vtk.js API index](https://kitware.github.io/vtk-js/api/), [HttpDataSetReader](https://kitware.github.io/vtk-js/api/IO_Core_HttpDataSetReader.html), [CutterMapper](https://kitware.github.io/vtk-js/api/Rendering_Core_CutterMapper.html), and [Mapper scalar APIs](https://kitware.github.io/vtk-js/api/Rendering_Core_Mapper.html).

## Measured source cost

The authoritative VTKHDF file is 53,426,406 bytes on disk. Its uncompressed array costs are:

| Array | Shape / type | Bytes |
| --- | --- | ---: |
| Points | 1,210,104 × 3 Float32 | 14,521,248 |
| Connectivity | 9,379,040 Int64 | 75,032,320 |
| Offsets | 1,172,381 Int64 | 9,379,048 |
| Cell types | 1,172,380 UInt8 | 1,172,380 |
| One scalar | 1,172,380 Float64 | 9,379,040 |
| One web scalar copy | 1,172,380 Float32 | 4,689,520 |
| All five source scalars | Float64 | 46,895,200 |

A full unstructured browser copy would start above 109 MB for topology plus one scalar, before JavaScript parsing copies, render buffers, and framework overhead. The selected prototype keeps a 4.69 MB scalar array, small axis/metadata JSON, and only one 146 × 146 layer of render geometry resident. A practical scientific-layer estimate is roughly 8–12 MB rather than more than 120 MB for the full unstructured route.

## Candidate comparison

| Path | Fidelity / topology / cell data | Browser and network cost | Slice / field switching | Future work and deployment |
| --- | --- | --- | --- | --- |
| A. VTKHDF → vtk.js HttpDataSetReader dataset | Can preserve full unstructured topology and cell arrays if a custom exporter is built. | High: points, connectivity, offsets, types, scalars, parser copies, and GPU buffers. | Generic but expensive for a one-plane cell slice; each field adds another full array. | Supports future unstructured algorithms, probes, and object storage, but a roughly 100+ MB resident representation is poor for static/Vercel delivery and 100 cases. |
| B. VTKHDF → VTU → vtk.js XML reader | VTU can preserve topology and cell data. | Highest parsing/transfer risk; XML wrappers and base64/appended payload handling add overhead. | Generic in theory. | Current vtk.js has no exported concrete VTU reader, so this requires extra implementation or a different library. A large VTU is unsuitable for the frontend bundle. |
| C. VTKHDF → FastAPI server-side slices | VTK performs authoritative cuts and can retain explicit provenance; returned geometry is compact. | Lowest browser memory and transfer per slice, but every interaction needs the backend. | Fast initial payload; field/case scaling shifts compute and caching to the server. | Good for arbitrary unstructured future cases and iso-surfaces. Raw probes can remain authoritative. Requires a separately hosted scientific backend; serverless/Vercel deployment is a poor fit for the 53 MB source and VTK runtime. |
| D. VTKHDF → exact rectilinear cell-grid web data | Exact for this mesh: all boundaries and one raw value per voxel are preserved. It would be invalid for a nonrectilinear case and the exporter rejects one. | One Float32 field is 4.69 MB plus small JSON; only one Z layer becomes render geometry. | Local Z updates are quick; later fields add one scalar payload each. | Raw voxel probe and 100-case asset catalogs remain feasible. Iso-surfaces need a cell-to-point visualization interpolation or a server-side path. Large generated case libraries belong in object storage, not Git/Vercel. |

## Prototype decision

Use D for this verified reference grid. A reproducible Python exporter validates every VTK cell as an adjacent axis-aligned voxel, maps it to exact nonuniform axis boundaries, and writes a manifest plus a little-endian Float32 visualization array. The authoritative Float64 VTKHDF is unchanged and ignored. Generated assets are also ignored and regenerated locally.

The browser draws a Z-normal layer in the existing React Three Fiber scene. CAD and field therefore share one renderer, camera, controls, viewport, depth buffer, and resize lifecycle; there is no camera synchronization protocol to drift. Each displayed rectangle uses its containing voxel's raw cell value with flat color. There is no point-data conversion or scientific interpolation.

The prototype is deliberately limited to Total Nuclear Heating. Arbitrary unstructured future meshes should use a server-side extraction path (C) or a purpose-built unstructured web pipeline rather than being coerced into this representation.

## Data and precision policy

`data/sample/test.vtkhdf` is the authoritative local simulation artifact and is never copied into `web/public`. Run:

```bat
cmd.exe /c "set PYTHONPATH=src&& .venv\Scripts\python.exe scripts\export_web_scientific_field.py"
```

This creates ignored files under `web/public/scientific/generated/`. Float32 is explicitly a visualization copy. The manifest records source and web ranges plus maximum, relative, and mean conversion deviations so precision loss cannot be silent.
