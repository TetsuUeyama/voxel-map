"""
Park09.blend → OBJ exporter

Separates the monolithic Cube mesh into individual objects by:
1. Material-based separation
2. Loose parts separation within each material group
3. Deduplication of identical parts (same vertex count + bounding box size)
4. Export each unique part as OBJ
5. Export one tree instance (trunk curve → mesh + leaves)
"""

import bpy
import bmesh
import os
import json
import math
from mathutils import Vector

OUTPUT_DIR = "C:/Users/user/Downloads/uploads_files_2046386_Park/exported_obj"
os.makedirs(OUTPUT_DIR, exist_ok=True)

# ── Helper: get bounding box dimensions rounded ──────────────────────

def bbox_signature(obj):
    """Return (vert_count, rounded_dimensions) as dedup key."""
    mesh = obj.data
    if not mesh or len(mesh.vertices) == 0:
        return None

    coords = [obj.matrix_world @ v.co for v in mesh.vertices]
    min_c = Vector((min(c.x for c in coords), min(c.y for c in coords), min(c.z for c in coords)))
    max_c = Vector((max(c.x for c in coords), max(c.y for c in coords), max(c.z for c in coords)))
    dims = max_c - min_c
    # Round to 1 decimal for dedup tolerance
    return (len(mesh.vertices), round(dims.x, 1), round(dims.y, 1), round(dims.z, 1))


def export_obj(obj, filepath):
    """Export a single object to OBJ with materials."""
    # Deselect all, select target
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj

    bpy.ops.wm.obj_export(
        filepath=filepath,
        export_selected_objects=True,
        export_uv=True,
        export_normals=True,
        export_materials=True,
        export_triangulated_mesh=True,
        apply_modifiers=True,
    )


# ── Step 1: Process Cube - separate by material then loose parts ─────

print("=== Processing Cube mesh ===")

cube = bpy.data.objects.get('Cube')
if not cube:
    print("ERROR: Cube not found")
else:
    # Duplicate cube for non-destructive work
    bpy.ops.object.select_all(action='DESELECT')
    cube.select_set(True)
    bpy.context.view_layer.objects.active = cube
    bpy.ops.object.duplicate()
    work_cube = bpy.context.active_object
    work_cube.name = "Cube_work"

    # Enter edit mode, separate by material
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.separate(type='MATERIAL')
    bpy.ops.object.mode_set(mode='OBJECT')

    # Get all separated pieces
    mat_pieces = [o for o in bpy.data.objects if o.name.startswith("Cube_work")]
    print(f"  Separated into {len(mat_pieces)} material groups")

    # For each material group, separate by loose parts
    all_parts = []
    for piece in mat_pieces:
        # Get material name
        mat_name = "unknown"
        if piece.data.materials:
            mat_name = piece.data.materials[0].name
        mat_name_safe = mat_name.replace(" ", "_").lower()

        # Separate by loose parts
        bpy.ops.object.select_all(action='DESELECT')
        piece.select_set(True)
        bpy.context.view_layer.objects.active = piece

        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.mesh.separate(type='LOOSE')
        bpy.ops.object.mode_set(mode='OBJECT')

        # Collect resulting parts
        parts = [o for o in bpy.data.objects if o.name.startswith(piece.name)]
        for p in parts:
            p["park_material"] = mat_name_safe
            all_parts.append(p)

    print(f"  Total loose parts: {len(all_parts)}")

    # Deduplicate
    seen_sigs = {}  # signature → (obj, mat_name, index)
    unique_parts = []

    for part in all_parts:
        sig = bbox_signature(part)
        if sig is None:
            continue
        mat_name = part.get("park_material", "unknown")
        dedup_key = (mat_name, sig)

        if dedup_key not in seen_sigs:
            seen_sigs[dedup_key] = len(unique_parts)
            unique_parts.append((part, mat_name))

    print(f"  Unique parts after dedup: {len(unique_parts)}")

    # Categorize: field (grass ground) vs objects
    field_parts = []
    object_parts = []

    for part, mat_name in unique_parts:
        sig = bbox_signature(part)
        if sig is None:
            continue
        vert_count = sig[0]
        # The large grass piece (27932 verts) is the field
        if mat_name == "grass" and vert_count > 5000:
            field_parts.append((part, mat_name))
        elif mat_name == "water" and vert_count > 100:
            field_parts.append((part, mat_name))
        else:
            object_parts.append((part, mat_name))

    print(f"  Field parts: {len(field_parts)}")
    print(f"  Object parts: {len(object_parts)}")

    # Export field parts
    field_names = []
    for i, (part, mat_name) in enumerate(field_parts):
        name = f"field_{mat_name}_{i+1:03d}"
        filepath = os.path.join(OUTPUT_DIR, f"{name}.obj")
        export_obj(part, filepath)
        field_names.append(name)
        sig = bbox_signature(part)
        print(f"  Exported field: {name} (verts: {sig[0] if sig else 0})")

    # Export object parts
    obj_names = []
    for i, (part, mat_name) in enumerate(object_parts):
        name = f"obj_{mat_name}_{i+1:03d}"
        filepath = os.path.join(OUTPUT_DIR, f"{name}.obj")
        export_obj(part, filepath)
        obj_names.append(name)
        sig = bbox_signature(part)
        print(f"  Exported object: {name} (verts: {sig[0] if sig else 0})")

    # Clean up work objects
    for part in all_parts:
        if part.name in bpy.data.objects:
            bpy.data.objects.remove(part, do_unlink=True)


# ── Step 2: Export tree (one instance) ───────────────────────────────

print("\n=== Processing Tree ===")

# Find first tree curve and its leaves
tree_curve = bpy.data.objects.get('tree')
leaves_mesh = bpy.data.objects.get('leaves')

if tree_curve and leaves_mesh:
    # Convert tree curve to mesh for export
    bpy.ops.object.select_all(action='DESELECT')
    tree_curve.select_set(True)
    bpy.context.view_layer.objects.active = tree_curve
    bpy.ops.object.duplicate()
    tree_mesh_obj = bpy.context.active_object
    tree_mesh_obj.name = "tree_trunk_export"
    bpy.ops.object.convert(target='MESH')

    # Export trunk
    trunk_path = os.path.join(OUTPUT_DIR, "tree_trunk.obj")
    export_obj(tree_mesh_obj, trunk_path)
    print(f"  Exported: tree_trunk.obj (verts: {len(tree_mesh_obj.data.vertices)})")

    # Export leaves
    leaves_path = os.path.join(OUTPUT_DIR, "tree_leaves.obj")
    export_obj(leaves_mesh, leaves_path)
    print(f"  Exported: tree_leaves.obj (verts: {len(leaves_mesh.data.vertices)})")

    # Clean up
    bpy.data.objects.remove(tree_mesh_obj, do_unlink=True)
else:
    print("  Tree or leaves not found!")


# ── Step 3: Also export from Bench1.blend and Bridge1.blend ──────────
# These are separate files, handled separately


# ── Write manifest ───────────────────────────────────────────────────

manifest = {
    "field_parts": field_names if 'field_names' in dir() else [],
    "object_parts": obj_names if 'obj_names' in dir() else [],
    "tree": ["tree_trunk", "tree_leaves"],
}

manifest_path = os.path.join(OUTPUT_DIR, "manifest.json")
with open(manifest_path, 'w') as f:
    json.dump(manifest, f, indent=2)

print(f"\nManifest written to {manifest_path}")
print("Done!")
