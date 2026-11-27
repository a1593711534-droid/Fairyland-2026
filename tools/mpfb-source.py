"""Extract the fitted CC0 MPFB head for resculpting in sculpt.py."""
from pathlib import Path
import bpy
from bl_ext.user_default.mpfb.services.humanservice import HumanService
from bl_ext.user_default.mpfb.services.targetservice import TargetService

out = Path(__file__).resolve().parent / 'reference' / 'lio-head.obj'
macro = TargetService.get_default_macro_info_dict()
macro.update(gender=.18, age=.48, muscle=.39, weight=.42)
human = HumanService.create_human(macro_detail_dict=macro)
evaluated = human.evaluated_get(bpy.context.evaluated_depsgraph_get())
body = evaluated.to_mesh()
top = max(v.co.z for v in body.vertices)
neck = top - .255
subset = {v.index: v.co for v in body.vertices if v.co.z >= neck}
faces = [list(poly.vertices) for poly in body.polygons if all(i in subset for i in poly.vertices)]
used = sorted(set(i for face in faces for i in face))
mapping = {value: i + 1 for i, value in enumerate(used)}
print('Head ranges', [(min(subset[i][a] for i in used),max(subset[i][a] for i in used)) for a in range(3)])
with out.open('w') as file:
    file.write('# MPFB core head, CC0, fitted in Blender\n')
    for index in used:
        file.write('v %.6f %.6f %.6f\n' % tuple(subset[index]))
    for face in faces:
        file.write('f ' + ' '.join(str(mapping[i]) for i in face) + '\n')
evaluated.to_mesh_clear()
