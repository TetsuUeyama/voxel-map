"""Verify city.blend export — check for instance collections, particle systems,
and per-object world locations vs OBJ output."""
import bpy

# ── Object type breakdown ───────────────────────────────────────────
types = {}
for o in bpy.data.objects:
    types[o.type] = types.get(o.type, 0) + 1
print(f"Total objects: {len(bpy.data.objects)}")
print(f"By type: {types}")

# ── Empty objects with instance_collection (collection instances) ──
empty_instances = [
    o for o in bpy.data.objects
    if o.type == 'EMPTY' and o.instance_collection is not None
]
print(f"\n*** Empties with instance_collection: {len(empty_instances)} ***")
for o in empty_instances[:20]:
    loc = o.matrix_world.translation
    print(f"  {o.name[:30]:30s} → {o.instance_collection.name[:25]:25s} at ({loc.x:7.2f}, {loc.y:7.2f}, {loc.z:7.2f})")
if len(empty_instances) > 20:
    print(f"  ... and {len(empty_instances) - 20} more")

# ── Particle systems on meshes ──────────────────────────────────────
ps_total = 0
ps_owners = []
for o in bpy.data.objects:
    if o.type == 'MESH':
        for ps in o.particle_systems:
            ps_total += 1
            ps_owners.append((o.name, ps.name))
print(f"\nParticle systems: {ps_total}")
for name, ps in ps_owners[:10]:
    print(f"  on {name} → {ps}")

# ── Sample mesh objects with name patterns ─────────────────────────
print(f"\n=== Sample mesh world locations ===")
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
patterns = ['Bush', 'Tree', 'Car', 'Building', 'House', 'Vehicle', 'Plant', 'Cube']
for pat in patterns:
    matches = [o for o in meshes if pat.lower() in o.name.lower()]
    if matches:
        print(f"\n{pat} ({len(matches)} matches):")
        for o in matches[:5]:
            loc = o.matrix_world.translation
            print(f"  {o.name[:35]:35s} loc=({loc.x:7.2f}, {loc.y:7.2f}, {loc.z:7.2f})")
        if len(matches) > 5:
            print(f"  ... +{len(matches) - 5} more")

# ── Distinct mesh data (linked duplicates check) ────────────────────
mesh_data_users = {}
for o in meshes:
    md = o.data.name
    mesh_data_users[md] = mesh_data_users.get(md, 0) + 1
shared = {k: v for k, v in mesh_data_users.items() if v > 1}
print(f"\n=== Mesh data sharing ===")
print(f"Distinct mesh data: {len(mesh_data_users)}")
print(f"Mesh data shared by 2+ objects: {len(shared)}")
top_shared = sorted(shared.items(), key=lambda x: -x[1])[:10]
for name, count in top_shared:
    print(f"  '{name[:30]}': used by {count} objects")
