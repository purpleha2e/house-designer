import bpy
import json
from pathlib import Path

root = Path.cwd()
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(root / 'exports/waterfall_shaker_island_blender.glb'))
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
assert len(meshes) == 5, len(meshes)
hardware = bpy.data.materials.get('Aged bronze hardware')
assert hardware is not None and hardware.use_nodes
shader = next(n for n in hardware.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
images = [i for i in bpy.data.images if i.type == 'IMAGE' and i.size[0] > 0]
assert any(tuple(i.size) == (1024, 1024) for i in images)
# Leave the hardware selected so its editable material is easy to find.
bpy.ops.object.select_all(action='DESELECT')
tap = next(o for o in meshes if any(s.material == hardware for s in o.material_slots))
tap.select_set(True)
bpy.context.view_layer.objects.active = tap
bpy.ops.file.pack_all()
output = root / 'exports/waterfall_shaker_island.blend'
bpy.ops.wm.save_as_mainfile(filepath=str(output))
print('ISLAND_IMPORT_PASS ' + json.dumps({
    'blender': bpy.app.version_string, 'meshObjects': len(meshes),
    'hardwareMaterial': hardware.name, 'metallic': shader.inputs['Metallic'].default_value,
    'roughness': shader.inputs['Roughness'].default_value,
    'images': [{'name': i.name, 'size': list(i.size), 'packed': bool(i.packed_file)} for i in images],
    'blend': str(output),
}))
