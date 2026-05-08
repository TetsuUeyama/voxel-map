"""Render the original city.blend from above so we can see how it's intended to look."""
import bpy
import os
import math
from mathutils import Vector

OUT_DIR = "C:/Users/user/developsecond/voxel-map/scripts/_renders"
os.makedirs(OUT_DIR, exist_ok=True)

scene = bpy.context.scene

# Switch to Eevee (fast)
scene.render.engine = 'BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in {e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items} else 'BLENDER_EEVEE'
scene.render.resolution_x = 800
scene.render.resolution_y = 800
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'

# Compute scene bounds
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
all_min = [float('inf')] * 3
all_max = [float('-inf')] * 3
for o in meshes:
    if not o.data.vertices:
        continue
    for v in o.data.vertices:
        c = o.matrix_world @ v.co
        if c.x < all_min[0]: all_min[0] = c.x
        if c.y < all_min[1]: all_min[1] = c.y
        if c.z < all_min[2]: all_min[2] = c.z
        if c.x > all_max[0]: all_max[0] = c.x
        if c.y > all_max[1]: all_max[1] = c.y
        if c.z > all_max[2]: all_max[2] = c.z

cx = (all_min[0] + all_max[0]) / 2
cy = (all_min[1] + all_max[1]) / 2
cz = (all_min[2] + all_max[2]) / 2
sz = max(all_max[0] - all_min[0], all_max[1] - all_min[1])

print(f"Scene center: ({cx:.2f}, {cy:.2f}, {cz:.2f}), max XY size: {sz:.2f}")

# Set up an orthographic top-down camera
cam_data = bpy.data.cameras.new('topdown_cam')
cam_data.type = 'ORTHO'
cam_data.ortho_scale = sz * 1.1
cam = bpy.data.objects.new('topdown_cam', cam_data)
scene.collection.objects.link(cam)
cam.location = (cx, cy, cz + sz)
cam.rotation_euler = (0, 0, 0)
scene.camera = cam

# Add ambient light
sun_data = bpy.data.lights.new('sun', type='SUN')
sun_data.energy = 5
sun = bpy.data.objects.new('sun', sun_data)
scene.collection.objects.link(sun)
sun.location = (cx, cy, cz + sz * 2)

scene.render.filepath = os.path.join(OUT_DIR, "city_topdown.png")
bpy.ops.render.render(write_still=True)
print(f"Wrote {scene.render.filepath}")

# Side view (looking +X from -X)
cam.location = (all_min[0] - sz * 0.3, cy, cz + (all_max[2] - all_min[2]) / 2)
cam.rotation_euler = (math.pi / 2, 0, -math.pi / 2)
cam_data.ortho_scale = max(all_max[1] - all_min[1], all_max[2] - all_min[2]) * 1.1
scene.render.filepath = os.path.join(OUT_DIR, "city_side.png")
bpy.ops.render.render(write_still=True)
print(f"Wrote {scene.render.filepath}")

# Perspective from corner
pcam_data = bpy.data.cameras.new('persp_cam')
pcam_data.type = 'PERSP'
pcam_data.lens = 35
pcam = bpy.data.objects.new('persp_cam', pcam_data)
scene.collection.objects.link(pcam)
diag = sz * 1.5
pcam.location = (cx + diag, cy - diag, cz + sz * 0.7)
# Look at center
look_dir = Vector((cx, cy, cz)) - Vector(pcam.location)
pcam.rotation_euler = look_dir.to_track_quat('-Z', 'Y').to_euler()
scene.camera = pcam
scene.render.filepath = os.path.join(OUT_DIR, "city_persp.png")
bpy.ops.render.render(write_still=True)
print(f"Wrote {scene.render.filepath}")
