# Module Layout Architecture V1

Module Layout V1 is a presentation geometry layer for the existing single-cell viewer. It repeats one applied single-cell geometry on a fixed flat-top hexagonal lattice. The external module RAFM envelope, rear manifold, coolant routing, and module-scale MCNP/CFX fields remain deferred.

## Fixed pitch

The authoritative transverse source is the current unit-cell outer RAFM hexagon. Its canonical viewer bounds are approximately:

- X: -72.17 to 72.17 mm (vertex-to-vertex width)
- Y: -62.50 to 62.50 mm (side-to-side height)
- Z: 0 to 921 mm (cell length)

For the repository's flat-top orientation, `R = outerWidth / 2` is the hex circumradius and `a = outerHeight / 2` is the apothem. Neighbor translations are derived without a user parameter:

```text
pitchX = 1.5 × R
pitchY = 2 × a
```

The seven transverse lanes use explicit occupancy data with four cells per lane: `4 / 4 / 4 / 4 / 4 / 4 / 4`, for 28 cells. The former fifth-column cells `R02-C05`, `R04-C05`, and `R06-C05` are intentionally absent. Odd lanes receive the half-pitch offset required by flat-top hex packing. Cell IDs are stable (`R01-C01`, `R02-C04`, …); axial coordinates `q/r` are retained for future layout work. The control-panel occupancy map derives tile positions from these same cell X/Y centers.

## Rendering and data policy

The frontend builds one parametric or GLB single-cell component tree, shares its `BufferGeometry` across cloned cell instance trees, and changes only X/Y translation. Component visibility and opacity are global group controls. Cell selection is represented by a lightweight hex outline and identity panel.

Module mode computes and uses the real array bounds for camera fitting and section clipping. Its scientific view is a tiled reference preview: one cached single-cell MCNP dataset (case `107-E`) is sliced in global module X/Y/Z coordinates, mapped into each intersected cell's local FMESH coordinates, and rendered as separate valid cell patches. Values remain unchanged and no interpolation bridges cells. This is explicitly not a module-scale MCNP result; true module MCNP and CFX data remain deferred.
