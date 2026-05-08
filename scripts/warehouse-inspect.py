"""Inspect warehouse6.blend — list objects, materials, bounding box."""
import bpy
import json

# Collect mesh objects
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
print(f"\n=== {len(meshes)} mesh objects ===")

# Overall scene bounding box
all_min = [float('inf')] * 3
all_max = [float('-inf')] * 3
total_verts = 0
total_polys = 0

for o in meshes[:30]:
    me = o.data
    nv = len(me.vertices)
    np_ = len(me.polygons)
    total_verts += nv
    total_polys += np_
    # World-space bounding box of object
    bb = [o.matrix_world @ v.co for v in me.vertices] if nv else []
    if bb:
        omin = [min(c.x for c in bb), min(c.y for c in bb), min(c.z for c in bb)]
        omax = [max(c.x for c in bb), max(c.y for c in bb), max(c.z for c in bb)]
        for i in range(3):
            all_min[i] = min(all_min[i], omin[i])
            all_max[i] = max(all_max[i], omax[i])
        size = [omax[i] - omin[i] for i in range(3)]
        print(f"  {o.name[:40]:40s} verts={nv:6d} polys={np_:6d}  size={size[0]:6.2f}×{size[1]:6.2f}×{size[2]:6.2f}m")
    else:
        print(f"  {o.name[:40]:40s} EMPTY")

if len(meshes) > 30:
    print(f"  ... and {len(meshes) - 30} more")

# Sum totals across ALL meshes
total_verts = sum(len(o.data.vertices) for o in meshes)
total_polys = sum(len(o.data.polygons) for o in meshes)

# Recompute scene bbox over ALL meshes
all_min = [float('inf')] * 3
all_max = [float('-inf')] * 3
for o in meshes:
    me = o.data
    if not me.vertices:
        continue
    bb = [o.matrix_world @ v.co for v in me.vertices]
    for c in bb:
        if c.x < all_min[0]: all_min[0] = c.x
        if c.y < all_min[1]: all_min[1] = c.y
        if c.z < all_min[2]: all_min[2] = c.z
        if c.x > all_max[0]: all_max[0] = c.x
        if c.y > all_max[1]: all_max[1] = c.y
        if c.z > all_max[2]: all_max[2] = c.z

scene_size = [all_max[i] - all_min[i] for i in range(3)]
print(f"\n=== Totals ===")
print(f"meshes:    {len(meshes)}")
print(f"vertices:  {total_verts:,}")
print(f"polygons:  {total_polys:,}")
print(f"bbox min:  {all_min[0]:.2f}, {all_min[1]:.2f}, {all_min[2]:.2f}")
print(f"bbox max:  {all_max[0]:.2f}, {all_max[1]:.2f}, {all_max[2]:.2f}")
print(f"bbox size: {scene_size[0]:.2f} × {scene_size[1]:.2f} × {scene_size[2]:.2f} m")

# Collect material names
mat_names = sorted({m.name for o in meshes for m in o.data.materials if m})
print(f"\n=== {len(mat_names)} materials ===")
for n in mat_names[:50]:
    print(f"  {n}")
if len(mat_names) > 50:
    print(f"  ... and {len(mat_names) - 50} more")

# Image textures used
images = sorted({img.filepath for img in bpy.data.images if img.filepath})
print(f"\n=== {len(images)} image textures ===")
for img in images[:20]:
    print(f"  {img}")
