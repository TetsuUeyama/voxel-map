"""
city.blend → OBJ + MTL + colors.json (combined exporter).
Exports all mesh objects to a single OBJ, plus a JSON of Principled BSDF base colors.
"""
import bpy
import json
import os

OUTPUT_DIR = "C:/Users/user/developsecond/game-assets/field/city"
OUTPUT_OBJ = os.path.join(OUTPUT_DIR, "city.obj")
OUTPUT_COLORS = os.path.join(OUTPUT_DIR, "city_colors.json")
os.makedirs(OUTPUT_DIR, exist_ok=True)

# ── Export OBJ ──────────────────────────────────────────────────────
bpy.ops.object.select_all(action='DESELECT')
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
if not meshes:
    raise SystemExit("No mesh objects found")
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]

print(f"Exporting {len(meshes)} meshes to {OUTPUT_OBJ}")
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
print("Done.")
