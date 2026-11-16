"""Import the delivered GLB, verify it and render front / rear studio views."""
import bpy
import json
from pathlib import Path
from mathutils import Vector

root = Path.cwd()
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(root / 'exports/junior-cabin-bed-spindles-left-hd.glb'))
objects = [o for o in bpy.context.scene.objects if o.type == 'MESH']
assert len(objects) == 6
assert len({slot.material for o in objects for slot in o.material_slots}) == 6
assert all(o.data.uv_layers for o in objects)
assert all(len(o.material_slots) == 1 for o in objects)
points = [o.matrix_world @ Vector(v) for o in objects for v in o.bound_box]
bounds = [[min(p[i] for p in points), max(p[i] for p in points)] for i in range(3)]
assert abs(bounds[0][1] - bounds[0][0] - 1.91) < 1e-5, bounds
assert abs(bounds[2][1] - 1.14) < 1e-5, bounds
print('BED_IMPORT_PASS', json.dumps({'boundsXYZ': bounds, 'meshes': len(objects),
    'materials': [o.material_slots[0].material.name for o in objects], 'allUVsPresent': True}))

# Save an editable Blender companion before adding the studio set.
bpy.context.scene.unit_settings.system = 'METRIC'
bpy.context.scene.unit_settings.length_unit = 'METERS'
bpy.ops.wm.save_as_mainfile(filepath=str(root / 'exports/junior-cabin-bed-spindles-left-hd.blend'))

scene = bpy.context.scene
scene.render.engine = 'BLENDER_EEVEE'
scene.eevee.use_gtao = True
scene.eevee.gtao_distance = .18
scene.eevee.gtao_factor = 1.1
scene.eevee.use_soft_shadows = True
scene.eevee.taa_render_samples = 128
scene.render.resolution_x = 1500
scene.render.resolution_y = 1125
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.view_settings.view_transform = 'Filmic'
scene.view_settings.look = 'Medium High Contrast'
scene.view_settings.exposure = 0
scene.view_settings.gamma = 1
scene.world.use_nodes = True
scene.world.node_tree.nodes['Background'].inputs[0].default_value = (.75,.79,.82,1)
scene.world.node_tree.nodes['Background'].inputs[1].default_value = .65

bpy.ops.mesh.primitive_plane_add(size=200, location=(0,0,-.006))
ground = bpy.data.materials.new('Studio ground • preview only')
ground.diffuse_color = (.88,.86,.82,1)
ground.use_nodes = True
ground.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (.88,.86,.82,1)
ground.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = .85
bpy.context.object.data.materials.append(ground)

def area(name, location, power, size, colour):
    data = bpy.data.lights.new(name, type='AREA')
    data.energy = power
    data.size = size
    data.color = colour
    data.use_shadow = True
    data.use_contact_shadow = True
    obj = bpy.data.objects.new(name, data)
    scene.collection.objects.link(obj)
    obj.location = location
    obj.rotation_euler = (Vector((0,0,.5))-obj.location).to_track_quat('-Z','Y').to_euler()

area('Large softbox', (-3,-4,6), 450, 4.5, (1,.94,.86))
area('Fill', (4,-1,3), 200, 3, (.85,.93,1))
area('Top rim', (0,4,4), 350, 3, (1,1,1))
data = bpy.data.cameras.new('Studio camera')
camera = bpy.data.objects.new('Studio camera',data)
scene.collection.objects.link(camera)
scene.camera = camera
data.type = 'ORTHO'
data.ortho_scale = 2.85
def render(name, position, target=(0,-.07,.57), scale=2.85):
    camera.location = position
    camera.rotation_euler = (Vector(target)-camera.location).to_track_quat('-Z','Y').to_euler()
    data.ortho_scale = scale
    scene.render.filepath = str(root / 'exports' / name)
    bpy.ops.render.render(write_still=True)

render('junior-cabin-bed-spindles-left-hd-preview.png', (3,-4.8,2.9))
render('junior-cabin-bed-spindles-left-hd-front.png', (1.1,-6,1.8), (0,-.05,.57), 2.55)
render('junior-cabin-bed-spindles-left-hd-rear.png', (-3,4,2.8))
