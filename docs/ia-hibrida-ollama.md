# IA híbrida: Groq, Gemini e Ollama

## Papel de cada provedor

| Provedor | Papel | Notas |
|----------|--------|--------|
| Groq | Padrão | Baixa latência, JSON estruturado (`generateObject`) |
| Gemini (`gemini-2.0-flash`) | Fallback cloud | Evitar modelos "thinking"/3.x no chat |
| Ollama (`qwen2.5:3b-instruct`) | Último recurso | Gratuito, local; lento em CPU. Usa texto→JSON (schema enorme derruba o runner 3B) |

Após 3 falhas seguidas, o provedor fica em circuito aberto ~2 minutos.

Antes de cada tentativa, o orquestrador faz um **health-check leve** (cache TTL ~45s):
- Ollama: `GET /api/tags`
- Groq/Gemini/OpenAI/OpenRouter: listagem barata de modelos
- Provedor “frio” é pulado sem gastar o timeout completo da mensagem

Variáveis opcionais: `LLM_HEALTH_TTL_MS` (padrão 45000), `LLM_HEALTH_PING_MS` (padrão 2500).

## Redis / BullMQ no chat — fora do escopo atual

O `/chat` é **síncrono** (request → interpreta → responde na mesma conexão). Colocar Redis + BullMQ nesse caminho:

1. Não corrige 503 de LLM (o worker falharia igual).
2. Obriga redesenhar a UI (jobId + polling/WebSocket).
3. Compete por RAM na KVM2 (8 GB) com API + Ollama.
4. Só brilha com vários workers/réplicas — ainda não é o caso.

**Adiar** fila no chat até multi-instância, relatórios pesados, webhooks ou fluxo “pense e avise depois”.

## Mac (desenvolvimento)

```bash
brew install ollama
ollama pull qwen2.5:3b-instruct
# garanta no .env:
# OLLAMA_BASE_URL=http://127.0.0.1:11434
# OLLAMA_MODEL=qwen2.5:3b-instruct
# LLM_ORDEM_FALLBACK=groq,gemini,ollama
pnpm dev
```

## Hostinger KVM2 (produção, 2 vCPU / 8 GB)

1. Instalar Ollama no servidor (script oficial ou Docker).
2. `ollama pull qwen2.5:3b-instruct` (~2–3.5 GB RAM em uso).
3. Mesmas variáveis de ambiente da API.
4. Deixe Groq/Gemini como caminhos principais; Ollama só evita 503.

Não use modelos 7B+ como único provedor nesse plano — aperta a RAM junto com a API Node.

## Testar só o Ollama

Temporariamente no `.env`:

```bash
LLM_PROVEDOR_PADRAO=ollama
LLM_ORDEM_FALLBACK=ollama
# comente ou esvazie GROQ_API_KEY / GEMINI_API_KEY
```

Reinicie a API e envie uma mensagem que force a IA (ex.: "como está a evolução dos meus gastos?").

No Mac, com Ollama já no ar (`ollama serve` ou app), o fallback local deve responder em ~20–40s no 3B.
