"""High-resolution top-down render for object identification."""
import bpy
import os

OUT_DIR = "C:/Users/user/developsecond/voxel-map/scripts/_renders"
os.makedirs(OUT_DIR, exist_ok=True)

scene = bpy.context.scene

scene.render.engine = 'BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in {e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items} else 'BLENDER_EEVEE'
scene.render.resolution_x = 1600
scene.render.resolution_y = 1600
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'

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

cam_data = bpy.data.cameras.new('topdown_cam_hires')
cam_data.type = 'ORTHO'
cam_data.ortho_scale = sz * 1.1
cam = bpy.data.objects.new('topdown_cam_hires', cam_data)
scene.collection.objects.link(cam)
cam.location = (cx, cy, cz + sz)
cam.rotation_euler = (0, 0, 0)
scene.camera = cam

sun_data = bpy.data.lights.new('sun_hires', type='SUN')
sun_data.energy = 5
sun = bpy.data.objects.new('sun_hires', sun_data)
scene.collection.objects.link(sun)
sun.location = (cx, cy, cz + sz * 2)

scene.render.filepath = os.path.join(OUT_DIR, "city_topdown_hires.png")
bpy.ops.render.render(write_still=True)
print(f"Wrote {scene.render.filepath}")
