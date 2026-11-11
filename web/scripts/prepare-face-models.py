"""Makes the two face models Flow ships from the OpenCV Zoo's files (needs `pip install onnx`).

    python3 scripts/prepare-face-models.py DIR

Downloads, checks the originals' SHA-256, and writes yunet.onnx and sface-int8.onnx to DIR (copy them to
src/features/player/xray/faces/models/). YuNet is unchanged. SFace's file lists weights as graph inputs as well as
initializers, which stops ONNX Runtime optimising it; those inputs are removed, changing no output."""
import hashlib, sys, urllib.request
import onnx

BASE = 'https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/'
YUNET = 'face_detection_yunet/face_detection_yunet_2026may.onnx'
SFACE = 'face_recognition_sface/face_recognition_sface_2021dec_int8bq.onnx'
SHA = {
    YUNET: 'ebafce4e3c118d6554634be5c27ab333b4c047a9a8c3faf1d7cf93101c22f0f0',
    SFACE: 'fb143eea07838aa532d1c95df5f69899974ea0140e1fba05e94204be13ed74ee',
}
out = sys.argv[1]
data = {}
for path, sha in SHA.items():
    blob = urllib.request.urlopen(BASE + path).read()
    assert hashlib.sha256(blob).hexdigest() == sha, f'{path} is not the file this was written for'
    data[path] = blob
open(f'{out}/yunet.onnx', 'wb').write(data[YUNET])
m = onnx.load_from_string(data[SFACE])
g = m.graph
inits = {t.name for t in g.initializer}
made = {o for n in g.node for o in n.output}
used = {x for n in g.node for x in n.input}
keep = [i for i in g.input if i.name == 'data' or (i.name in used and i.name not in inits and i.name not in made)]
del g.input[:]
g.input.extend(keep)
onnx.checker.check_model(m)
onnx.save(m, f'{out}/sface-int8.onnx')
