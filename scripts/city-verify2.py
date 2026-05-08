"""Deeper inspection: visibility flags, hidden objects, large bounding cubes,
and per-object world bbox sanity check."""
import bpy

meshes = [o for o in bpy.data.objects if o.type == 'MESH']

# ── Visibility flags ────────────────────────────────────────────────
hidden_viewport = [o for o in meshes if o.hide_viewport]
hidden_render = [o for o in meshes if o.hide_render]
hidden_get = [o for o in meshes if o.hide_get()]
print(f"Mesh objects: {len(meshes)}")
print(f"  hide_viewport=True: {len(hidden_viewport)}")
print(f"  hide_render=True:   {len(hidden_render)}")
print(f"  hide_get():         {len(hidden_get)}")
print()

# Show some hidden ones
if hidden_render:
    print(f"=== Hidden from render (first 10): ===")
    for o in hidden_render[:10]:
        loc = o.matrix_world.translation
        nv = len(o.data.vertices)
        print(f"  {o.name[:35]:35s} verts={nv:6d} loc=({loc.x:7.2f}, {loc.y:7.2f}, {loc.z:7.2f})")
    if len(hidden_render) > 10:
        print(f"  ... +{len(hidden_render) - 10} more")

if hidden_viewport:
    print(f"\n=== Hidden in viewport (first 10): ===")
    for o in hidden_viewport[:10]:
        loc = o.matrix_world.translation
        nv = len(o.data.vertices)
        print(f"  {o.name[:35]:35s} verts={nv:6d} loc=({loc.x:7.2f}, {loc.y:7.2f}, {loc.z:7.2f})")
    if len(hidden_viewport) > 10:
        print(f"  ... +{len(hidden_viewport) - 10} more")

# ── Large objects (potential encompassing cubes) ────────────────────
print(f"\n=== Top 15 largest objects by bbox volume ===")
def bbox_size(o):
    if not o.data.vertices:
        return (0, 0, 0, 0)
    coords = [o.matrix_world @ v.co for v in o.data.vertices]
    sx = max(c.x for c in coords) - min(c.x for c in coords)
    sy = max(c.y for c in coords) - min(c.y for c in coords)
    sz = max(c.z for c in coords) - min(c.z for c in coords)
    return (sx, sy, sz, sx * sy * sz)

with_size = [(o, bbox_size(o)) for o in meshes]
with_size.sort(key=lambda x: -x[1][3])
for o, (sx, sy, sz, vol) in with_size[:15]:
    loc = o.matrix_world.translation
    print(f"  {o.name[:30]:30s} size={sx:6.2f}×{sy:6.2f}×{sz:6.2f}  vol={vol:8.2f}  loc=({loc.x:6.2f},{loc.y:6.2f},{loc.z:6.2f})  hide_render={o.hide_render}")

# ── Compare render-only export vs all-mesh export ───────────────────
visible_for_render = [o for o in meshes if not o.hide_render]
print(f"\nObjects suitable for render: {len(visible_for_render)} (vs {len(meshes)} total)")

# Vertex totals
total_v_all = sum(len(o.data.vertices) for o in meshes)
total_v_visible = sum(len(o.data.vertices) for o in visible_for_render)
print(f"Total vertices (all):     {total_v_all:,}")
print(f"Total vertices (visible): {total_v_visible:,}")
