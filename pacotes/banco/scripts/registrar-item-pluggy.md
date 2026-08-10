# Registrar itemId (Meu Pluggy) no LançAI

Após o reset financeiro e com o item visível na Application Pluggy:

```bash
# Produção
curl -sS -X POST https://api.lancai.xploreia.com/open-finance/conexoes \
  -H 'Content-Type: application/json' \
  -d '{"usuarioId":"<UUID_USUARIO_LANCAI>","conexaoExterna":"<ITEM_ID_PLUGGY>"}' | jq .

# Local
curl -sS -X POST http://localhost:3333/open-finance/conexoes \
  -H 'Content-Type: application/json' \
  -d '{"usuarioId":"<UUID_USUARIO_LANCAI>","conexaoExterna":"<ITEM_ID_PLUGGY>"}' | jq .
```

Resposta esperada: `201` com `conexao` (instituição, status) e `contas` materializadas.

Depois, no Web `/conexoes` → **Atualizar agora** (ou aguardar webhook `transactions/created`).

Validar item na Pluggy (opcional):

```bash
API_KEY=$(curl -sS -X POST https://api.pluggy.ai/auth \
  -H 'Content-Type: application/json' \
  -d "{\"clientId\":\"$PLUGGY_CLIENT_ID\",\"clientSecret\":\"$PLUGGY_CLIENT_SECRET\"}" \
  | jq -r .apiKey)

curl -sS "https://api.pluggy.ai/accounts?itemId=$ITEM_ID" \
  -H "X-API-KEY: $API_KEY" | jq '.results[] | {id,name,type,subtype}'
```
