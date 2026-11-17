#!/usr/bin/env node
/**
 * Git 内容过滤器：敏感值脱敏 / 还原。
 *
 * 由 .gitattributes 的 `filter=mm-secret` 触发，git 以 <clean|smudge> 参数调用：
 * - clean ：真实值 → 占位符。只在写入 git 索引与对象时生效，**工作区文件不会被改动**；
 * - smudge：占位符 → 真实值。检出文件时还原成本地可直接运行的配置。
 *
 * 真实值来自 .secrets/local.json（已在 .gitignore 中排除，不进仓库）：
 *   { "env-xxxxxxxxxxxxxxxx": "env-__SPACE_ID__" }
 * 键为真实值，值为仓库中显示的占位符；新增敏感项只需在此追加一条。
 *
 * 未配置该文件时（例如他人在新机器 clone）两个方向都原样透传，
 * 仓库里的占位符会被直接检出，项目仍可打开，只是缺少本地的服务空间配置。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const mode = process.argv[2]

/** 仓库根目录：本文件位于 <root>/scripts/ 下 */
const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/** 读取本地映射，缺失或损坏时降级为空映射（透传） */
function loadMap() {
  try {
    const parsed = JSON.parse(readFileSync(join(root, '.secrets', 'local.json'), 'utf8'))
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

/** 按真实值长度倒序，避免短值先替换破坏长值 */
const pairs = Object.entries(loadMap())
  .filter(([real, placeholder]) => typeof real === 'string' && real && typeof placeholder === 'string' && placeholder)
  .sort((a, b) => b[0].length - a[0].length)

/** 逐块读取 stdin，避免大文件被截断 */
const chunks = []
for await (const chunk of process.stdin) chunks.push(chunk)
let text = Buffer.concat(chunks).toString('utf8')

for (const [real, placeholder] of pairs) {
  const [from, to] = mode === 'smudge' ? [placeholder, real] : [real, placeholder]
  text = text.split(from).join(to)
}

// 不加换行，保持与输入字节一致
process.stdout.write(text)
