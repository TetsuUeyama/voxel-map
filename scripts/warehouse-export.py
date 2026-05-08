"""
warehouse6.blend → OBJ + MTL exporter.

Joins all mesh objects into a single mesh and exports to a single OBJ
with materials. Z-up is preserved (Blender default).
"""
import bpy
import os

OUTPUT_DIR = "C:/Users/user/developsecond/game-assets/field/warehouse"
OUTPUT_OBJ = os.path.join(OUTPUT_DIR, "warehouse6.obj")
os.makedirs(OUTPUT_DIR, exist_ok=True)

# Select all mesh objects
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
    forward_axis='Y',  # match VOX convention later
    up_axis='Z',
)

# Report file size
size = os.path.getsize(OUTPUT_OBJ)
print(f"OBJ size: {size / 1024 / 1024:.2f} MB")
mtl_path = OUTPUT_OBJ.replace('.obj', '.mtl')
if os.path.exists(mtl_path):
    print(f"MTL size: {os.path.getsize(mtl_path) / 1024:.2f} KB")
print("Done.")
