"""
Cafe.fbx → OBJ + colors.json (Blender exporter for the Cafe model).

Imports the FBX into a fresh scene, exports all meshes to a single OBJ,
and dumps each material's Principled BSDF base color to JSON.

Run with:
  blender --background --python scripts/cafe-export.py
"""
import bpy
import json
import os

INPUT_FBX = "C:/Users/user/Downloads/uploads_files_6212131_Cafe/Cafe.fbx"
OUTPUT_DIR = "C:/Users/user/developsecond/game-assets/field/cafe"
OUTPUT_OBJ = os.path.join(OUTPUT_DIR, "cafe.obj")
OUTPUT_COLORS = os.path.join(OUTPUT_DIR, "cafe_colors.json")
os.makedirs(OUTPUT_DIR, exist_ok=True)

# ── Clean default scene ─────────────────────────────────────────────
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete()
for block in list(bpy.data.materials):
    bpy.data.materials.remove(block)

# ── Import FBX ──────────────────────────────────────────────────────
print(f"Importing {INPUT_FBX}")
bpy.ops.import_scene.fbx(filepath=INPUT_FBX)

meshes = [o for o in bpy.data.objects if o.type == 'MESH']
if not meshes:
    raise SystemExit("No mesh objects found after FBX import")
print(f"Imported {len(meshes)} meshes, {len(bpy.data.materials)} materials")

# ── Export OBJ ──────────────────────────────────────────────────────
bpy.ops.object.select_all(action='DESELECT')
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]

print(f"Exporting OBJ to {OUTPUT_OBJ}")
bpy.ops.wm.obj_export(
    filepath=OUTPUT_OBJ,
    export_selected_objects=True,
    export_uv=False,
    export_normals=False,
    export_materials=True,
    export_triangulated_mesh=True,
    apply_modifiers=True,
    forward_axis='Y',
    up_axis='Z',
)
size = os.path.getsize(OUTPUT_OBJ)
print(f"OBJ size: {size / 1024 / 1024:.2f} MB")

# ── Extract material colors ─────────────────────────────────────────
def get_color(mat):
    if mat.use_nodes and mat.node_tree:
        for node in mat.node_tree.nodes:
            if node.type == 'BSDF_PRINCIPLED':
                bc = node.inputs.get('Base Color')
                if bc:
                    c = bc.default_value
                    return [round(c[0], 4), round(c[1], 4), round(c[2], 4)]
    dc = mat.diffuse_color
    return [round(dc[0], 4), round(dc[1], 4), round(dc[2], 4)]

result = {}
for mat in bpy.data.materials:
    if mat is None:
        continue
    safe_name = mat.name.replace(' ', '_')
    result[safe_name] = get_color(mat)

with open(OUTPUT_COLORS, 'w') as f:
    json.dump(result, f, indent=2)
print(f"Wrote {len(result)} material colors to {OUTPUT_COLORS}")

# ── Bounds report ───────────────────────────────────────────────────
mins = [float('inf')] * 3
maxs = [float('-inf')] * 3
for o in meshes:
    for corner in o.bound_box:
        wp = o.matrix_world @ __import__('mathutils').Vector(corner)
        for i in range(3):
            if wp[i] < mins[i]:
                mins[i] = wp[i]
            if wp[i] > maxs[i]:
                maxs[i] = wp[i]
print(f"Bounds (m): X {maxs[0] - mins[0]:.2f}, Y {maxs[1] - mins[1]:.2f}, Z {maxs[2] - mins[2]:.2f}")
print("Done.")
