meta:
  id: pko_lgo
  title: PKO LGO Geometry Container
  endian: le
  file-extension: lgo
  imports:
    - pko_lmo
doc: |
  Direct lwGeomObjInfo container used by .lgo resources.
  The layout is:
    - u32 version
    - lwGeomObjInfo payload (same body parser as geometry chunks in pko_lmo)

seq:
  - id: version
    type: u4
  - id: geometry
    size-eos: true
    type: pko_lmo::geometry_chunk(version, 0)
