// Copies only local model settings into an isolated evaluation directory. Never migrates the source.
const fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os');
const evaluationSource = () =>
  path.resolve(
    process.env.ATLAS_EVALUATION_DATA_ROOT ||
      process.env.ATLAS_DATA_ROOT ||
      path.join(os.homedir(), '.local/share/zhitu-atlas')
  );
function read(file) {
  let fd;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const s = fs.fstatSync(fd);
    if (!s.isFile() || s.size > 1024 * 1024) throw Error('invalid');
    const data = JSON.parse(fs.readFileSync(fd, 'utf8'));
    if (!Array.isArray(data)) throw Error('invalid');
    return data;
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw Error('评估配置不可读取，未输出内容或修改来源');
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}
function copyEvaluationConfig(source, target) {
  source = path.resolve(source);
  target = path.resolve(target);
  if (
    target === source ||
    source.startsWith(target + path.sep) ||
    target.startsWith(source + path.sep)
  )
    throw Error('评估目录必须与来源完全隔离');
  const current = read(path.join(source, 'private/models.json')),
    legacy = read(path.join(source, 'config/llm.json'));
  if (current && legacy && JSON.stringify(current) !== JSON.stringify(legacy))
    throw Error('新旧模型配置冲突，先在应用中核对再评估');
  const data = current || legacy;
  if (!data) throw Error('未找到本机模型配置；可用 ATLAS_EVALUATION_DATA_ROOT 指定来源');
  const dir = path.join(target, 'private');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (fs.lstatSync(dir).isSymbolicLink()) throw Error('评估私有目录不能使用链接');
  fs.chmodSync(dir, 0o700);
  fs.writeFileSync(path.join(dir, 'models.json'), JSON.stringify(data), {
    mode: 0o600,
    flag: 'wx'
  });
  return { copied: true };
}
module.exports = { evaluationSource, copyEvaluationConfig };
