"""Extract material base colors from Principled BSDF nodes → JSON."""
import bpy
import json
import os

OUTPUT_PATH = "C:/Users/user/developsecond/game-assets/field/warehouse/warehouse6_colors.json"

def get_color(mat):
    """Return [r,g,b] from Principled BSDF base_color, fallback to diffuse_color."""
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
    # Match the OBJ exporter's name sanitization (spaces → underscore)
    safe_name = mat.name.replace(' ', '_')
    result[safe_name] = get_color(mat)

with open(OUTPUT_PATH, 'w') as f:
    json.dump(result, f, indent=2)

print(f"Wrote {len(result)} material colors to {OUTPUT_PATH}")
for name, c in list(result.items())[:10]:
    print(f"  {name:30s} {c}")
