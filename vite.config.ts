import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'

// ---------------------------------------------------------------------------
// Projetos gravados em pasta do computador.
//
// O navegador guarda uma cópia de trabalho, mas a fonte de verdade é a pasta:
//   <pasta>/<Nome do projeto> (<id>)/projeto.json
//                                   /fundos/<camada>.png      imagens de fundo
//                                   /miniaturas/<foto>.jpg    miniaturas da galeria
//                                   /backups/projeto AAAA-MM-DD.json
//   <pasta>/_lixeira/...   projetos excluídos (nada é apagado de verdade)
//
// A pasta vem de dados.config.json ({"pasta": "C:\\..."}), que não vai para o
// git. Sem esse arquivo, usa projetos-dados/ dentro da pasta do sistema.
// ---------------------------------------------------------------------------

const RAIZ = process.cwd()
const TIPOS = new Set(['fundos', 'miniaturas'])
const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }
const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' }
const ID_OK = /^[A-Za-z0-9_-]{1,80}$/
const MAX_BACKUPS = 15

function pastaDados(): string {
  let pasta = path.join(RAIZ, 'projetos-dados')
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(RAIZ, 'dados.config.json'), 'utf-8')) as { pasta?: string }
    if (cfg.pasta && cfg.pasta.trim()) pasta = cfg.pasta.trim()
  } catch {
    /* sem configuração: pasta padrão */
  }
  fs.mkdirSync(pasta, { recursive: true })
  return pasta
}

function nomeLimpo(nome: string): string {
  const n = (nome || '')
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
  return (n || 'Projeto').slice(0, 60)
}

function acharPasta(base: string, id: string): string | null {
  for (const e of fs.readdirSync(base, { withFileTypes: true }))
    if (e.isDirectory() && e.name.endsWith(`(${id})`)) return path.join(base, e.name)
  return null
}

function idDaPasta(nome: string): string | null {
  const m = nome.match(/\(([A-Za-z0-9_-]+)\)$/)
  return m ? m[1] : null
}

function lerCorpo(req: IncomingMessage): Promise<Buffer> {
  return new Promise((res, rej) => {
    const partes: Buffer[] = []
    req.on('data', (c: Buffer) => partes.push(c))
    req.on('end', () => res(Buffer.concat(partes)))
    req.on('error', rej)
  })
}

function gravarSeguro(arq: string, dados: Buffer | string) {
  const tmp = `${arq}.tmp`
  fs.writeFileSync(tmp, dados)
  try {
    fs.renameSync(tmp, arq)
  } catch {
    // arquivo ocupado (ex.: sincronização do OneDrive): grava direto
    fs.writeFileSync(arq, dados)
    fs.rmSync(tmp, { force: true })
  }
}

function hoje(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function json(res: ServerResponse, status: number, corpo: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(corpo))
}

async function tratar(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const base = pastaDados()
  const url = new URL(req.url ?? '/', 'http://localhost')
  const partes = url.pathname
    .replace(/^\/api\/?/, '')
    .split('/')
    .filter(Boolean)
    .map(decodeURIComponent)
  const metodo = req.method ?? 'GET'

  if (partes[0] === 'info') return json(res, 200, { pasta: base })
  if (partes[0] !== 'projetos') return json(res, 404, { erro: 'rota desconhecida' })

  // lista de projetos (e os excluídos, para o navegador não reenviar o que foi apagado)
  if (partes.length === 1) {
    const projetos: { id: string; nome: string; updatedAt: number }[] = []
    for (const e of fs.readdirSync(base, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name.startsWith('_')) continue
      try {
        const p = JSON.parse(fs.readFileSync(path.join(base, e.name, 'projeto.json'), 'utf-8'))
        if (p?.id) projetos.push({ id: p.id, nome: p.nome ?? '', updatedAt: p.updatedAt ?? 0 })
      } catch {
        /* pasta sem projeto válido: ignora */
      }
    }
    const lixo = path.join(base, '_lixeira')
    const excluidos = fs.existsSync(lixo)
      ? fs
          .readdirSync(lixo)
          .map((n) => idDaPasta(n.replace(/ - excluído em .*$/, '')))
          .filter(Boolean)
      : []
    return json(res, 200, { pasta: base, projetos, excluidos })
  }

  const id = partes[1]
  if (!ID_OK.test(id)) return json(res, 400, { erro: 'id inválido' })

  // ----- projeto.json -----
  if (partes.length === 2) {
    const dir = acharPasta(base, id)
    if (metodo === 'GET') {
      if (!dir) return json(res, 404, { erro: 'projeto não encontrado' })
      res.statusCode = 200
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.setHeader('Cache-Control', 'no-store')
      res.end(fs.readFileSync(path.join(dir, 'projeto.json')))
      return
    }
    if (metodo === 'PUT' || metodo === 'POST') {
      const corpo = await lerCorpo(req)
      const proj = JSON.parse(corpo.toString('utf-8')) as { id?: string; nome?: string }
      if (proj.id !== id) return json(res, 400, { erro: 'id não confere' })
      const alvo = path.join(base, `${nomeLimpo(proj.nome ?? '')} (${id})`)
      let atual = dir
      if (!atual) {
        fs.mkdirSync(alvo, { recursive: true })
        atual = alvo
      } else if (atual !== alvo) {
        // projeto renomeado: a pasta acompanha o nome
        try {
          fs.renameSync(atual, alvo)
          atual = alvo
        } catch {
          /* pasta em uso: mantém o nome antigo */
        }
      }
      const arq = path.join(atual, 'projeto.json')
      // uma cópia de segurança por dia, da versão anterior
      if (fs.existsSync(arq)) {
        const bdir = path.join(atual, 'backups')
        const bkp = path.join(bdir, `projeto ${hoje()}.json`)
        if (!fs.existsSync(bkp)) {
          fs.mkdirSync(bdir, { recursive: true })
          fs.copyFileSync(arq, bkp)
          const antigos = fs
            .readdirSync(bdir)
            .filter((n) => n.startsWith('projeto '))
            .sort()
          for (const n of antigos.slice(0, Math.max(0, antigos.length - MAX_BACKUPS)))
            fs.rmSync(path.join(bdir, n), { force: true })
        }
      }
      gravarSeguro(arq, JSON.stringify(proj, null, 1))
      return json(res, 200, { ok: true, pasta: atual })
    }
    if (metodo === 'DELETE') {
      if (dir) {
        const lixo = path.join(base, '_lixeira')
        fs.mkdirSync(lixo, { recursive: true })
        let destino = path.join(lixo, path.basename(dir))
        if (fs.existsSync(destino)) destino = path.join(lixo, `${path.basename(dir)} - excluído em ${Date.now()}`)
        fs.renameSync(dir, destino)
      }
      return json(res, 200, { ok: true })
    }
    return json(res, 405, { erro: 'método não permitido' })
  }

  // ----- arquivos do projeto (fundos, miniaturas) -----
  const tipo = partes[2]
  const nome = partes[3]
  if (!TIPOS.has(tipo) || !nome || !ID_OK.test(nome)) return json(res, 400, { erro: 'arquivo inválido' })
  const dir = acharPasta(base, id)
  if (!dir) return json(res, 404, { erro: 'projeto não encontrado' })
  const sub = path.join(dir, tipo)
  const existentes = fs.existsSync(sub)
    ? fs.readdirSync(sub).filter((n) => n.startsWith(`${nome}.`) && !n.endsWith('.tmp'))
    : []

  if (metodo === 'GET') {
    if (!existentes.length) return json(res, 404, { erro: 'arquivo não encontrado' })
    const ext = existentes[0].split('.').pop() ?? ''
    res.statusCode = 200
    res.setHeader('Content-Type', MIME[ext] ?? 'application/octet-stream')
    res.setHeader('Cache-Control', 'no-store')
    res.end(fs.readFileSync(path.join(sub, existentes[0])))
    return
  }
  if (metodo === 'PUT' || metodo === 'POST') {
    const corpo = await lerCorpo(req)
    const ext = EXT[String(req.headers['content-type'] ?? '').split(';')[0].trim()] ?? 'png'
    fs.mkdirSync(sub, { recursive: true })
    for (const n of existentes) if (n !== `${nome}.${ext}`) fs.rmSync(path.join(sub, n), { force: true })
    gravarSeguro(path.join(sub, `${nome}.${ext}`), corpo)
    return json(res, 200, { ok: true })
  }
  if (metodo === 'DELETE') {
    for (const n of existentes) fs.rmSync(path.join(sub, n), { force: true })
    return json(res, 200, { ok: true })
  }
  return json(res, 405, { erro: 'método não permitido' })
}

function projetosEmPasta(): Plugin {
  const middleware = (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (!req.url || !req.url.startsWith('/api/')) return next()
    tratar(req, res).catch((e: unknown) => json(res, 500, { erro: String((e as Error)?.message ?? e) }))
  }
  return {
    name: 'projetos-em-pasta',
    configureServer(server) {
      server.middlewares.use(middleware)
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware)
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), projetosEmPasta()],
})
