# Rastreio do produto enviado ao criador

API para cadastrar um código de rastreio, consultar um agregador fictício e guardar um status estável: `postado`, `em_transito`, `saiu_para_entrega`, `entregue`, `excecao`.

O prazo do conteúdo só conta depois que o pacote chega. Enquanto o status não é `entregue`, a API marca `atrasado: true` se o tempo desde o evento mais antigo passar de um limite configurável. Entrega concluída não vira atraso, mesmo que o relógio avance depois.

## Como rodar

Requer Node.js 22 ou superior.

```bash
npm install
npm test
npm run typecheck
npm start
```

`npm start` compila `src/` para `dist/` e sobe o servidor em `http://127.0.0.1:3000`.

Para rodar o fluxo completo com o agregador fictício de `examples/`, use dois terminais. O agregador escuta em `http://127.0.0.1:9099`.

```bash
node examples/agregador-ficticio.mjs
```

```bash
npm start
```

Variáveis opcionais:

| Variável | Padrão | Efeito |
|---|---|---|
| `PORT` | `3000` | Porta HTTP. Inteiro entre 1 e 65535. |
| `LIMITE_EM_TRANSITO_HORAS` | `48` | Limite para marcar atraso, em horas. Número maior que zero. |
| `AGREGADOR_URL` | `http://127.0.0.1:9099` | Base do agregador. O padrão é o fictício de `examples/`. |

Valor inválido impede a subida do servidor e a mensagem diz qual variável está errada. Um limite inválido nunca vira "sem atraso" em silêncio.

O cliente chama `GET {AGREGADOR_URL}/rastreios/{codigo}`, espera no máximo 5 segundos e lê um JSON com a lista `events`.

## Payload bruto e status normalizado

O agregador fala este dialeto. Só `src/infra/agregador-http.ts` conhece essas chaves e esses status brutos. O domínio recebe o status já traduzido.

```json
{
  "tracking_code": "BR123456789",
  "events": [
    {
      "event_id": "evt-1",
      "happened_at": "2026-03-01T12:00:00.000Z",
      "carrier_status": "IN_TRANSIT",
      "description": "Objeto em trânsito"
    }
  ]
}
```

Depois da tradução (`IN_TRANSIT` → `em_transito`), numa consulta logo após o evento:

```json
{
  "codigo": "BR123456789",
  "status": "em_transito",
  "historico": [
    {
      "id": "evt-1",
      "ocorridoEm": "2026-03-01T12:00:00.000Z",
      "status": "em_transito",
      "statusBruto": "IN_TRANSIT"
    }
  ],
  "atrasado": false
}
```

Status brutos conhecidos. A comparação ignora maiúsculas, minúsculas e espaços nas pontas.

| Bruto | Estável |
|---|---|
| `POSTED`, `OBJ_POSTADO` | `postado` |
| `IN_TRANSIT`, `OBJ_EM_TRANSITO` | `em_transito` |
| `OUT_FOR_DELIVERY`, `OBJ_SAIU` | `saiu_para_entrega` |
| `DELIVERED`, `OBJ_ENTREGUE` | `entregue` |
| `EXCEPTION`, `OBJ_EXCECAO` | `excecao` |
| qualquer outro | `excecao` |

Um status inventado pela transportadora nunca vira `entregue`.

## Exemplos

Cadastrar (`201`; repetir o mesmo código responde `200` com o estado atual):

```bash
curl -s -X POST http://127.0.0.1:3000/rastreios \
  -H 'content-type: application/json' \
  -d '{"codigo":"BR123456789"}'
```

```json
{
  "codigo": "BR123456789",
  "status": null,
  "historico": [],
  "atrasado": false
}
```

Sincronizar busca o agregador; consultar só lê o que está salvo. As duas respostas são iguais. Como o evento do exemplo é de março de 2026, hoje ele já aparece atrasado:

```bash
curl -s -X POST http://127.0.0.1:3000/rastreios/BR123456789/sincronizar
curl -s http://127.0.0.1:3000/rastreios/BR123456789
```

```json
{
  "codigo": "BR123456789",
  "status": "em_transito",
  "historico": [
    {
      "id": "evt-1",
      "ocorridoEm": "2026-03-01T12:00:00.000Z",
      "status": "em_transito",
      "statusBruto": "IN_TRANSIT"
    }
  ],
  "atrasado": true
}
```

Todo erro sai no formato `{"erro": "..."}`, mapeado num único `setErrorHandler`:

| Situação | Status | Corpo |
|---|---|---|
| Código vazio, só com espaços, ausente ou que não é texto | `400` | `{"erro":"Informe um código não vazio"}` |
| JSON malformado no corpo do cadastro | `400` | mensagem do Fastify |
| Código não cadastrado na consulta ou na sincronização | `404` | `{"erro":"Rastreio não encontrado: NAO-EXISTE"}` |
| Agregador ainda sem eventos para o código (`404` do agregador) | `200` | `status: null` e `historico: []`, sem erro |
| Agregador fora do ar, com erro HTTP diferente de `404`, com JSON ilegível, com payload de outro código ou sem resposta no tempo limite | `502` | `{"erro":"Agregador indisponível para BR123456789"}` |
| Erro inesperado | `500` | `{"erro":"Erro interno"}`, detalhe só no log |

Na falha de sincronização (`502`), o estado salvo fica como estava e a causa (timeout, rede, payload) vai para o log em `error.cause`. Cadastro e consulta seguem com o que já está salvo.

## Como o atraso é detectado

O relógio entra por uma interface `Clock`. O domínio não chama `Date.now()`.

- A contagem começa no evento mais antigo do histórico. `postado` também conta.
- `atrasado` é `true` só quando o status atual não é `entregue` e `agora - início > limite`.
- No limite exato (48h, por exemplo) ainda não há atraso: é preciso passar do limite.
- Uma entrega no prazo continua `atrasado: false` mesmo que a consulta aconteça dias depois. O alerta é sobre pacote que ainda não chegou, não sobre entrega já concluída.
- Sem nenhum evento não há início de contagem, então `atrasado` é `false`.
- `atrasado` não é gravado: o repositório guarda os eventos e o campo é recalculado com o relógio a cada resposta.
- O aviso é o próprio campo `atrasado` na resposta. Não há canal externo (e-mail, fila); veja "O que ficou de fora".

## Decisões

- **Porta do agregador.** O serviço depende de `AgregadorRastreio`, que devolve `id`, `ocorridoEm`, `status` (já estável) e `statusBruto`. Trocar o fornecedor é outro adaptador com o próprio dialeto. O domínio não muda: `traduzirStatus` é uma função pura que recebe o dialeto como dado.
- **statusBruto.** Fica em cada evento do histórico para auditoria. O contrato que os consumidores usam é `status`.
- **Status atual.** É o do evento com maior `ocorridoEm`. Se dois eventos caem no mesmo instante, fica o mais adiantado nesta ordem: `postado`, `em_transito`, `saiu_para_entrega`, `excecao`, `entregue`. `entregue` é final: depois de uma entrega registrada, o status não volta, nem com evento mais novo, nem com nova versão do mesmo `id`. Os eventos continuam no histórico.
- **Consultar de novo.** "Consultar" o agregador é o `POST /sincronizar`; o `GET` só lê. Sincronizar o mesmo código várias vezes não duplica o histórico.
- **Evento repetido ou corrigido.** O histórico é um conjunto por `event_id`. Para o mesmo id, fica a versão com `ocorridoEm` mais recente; uma versão antiga que chega depois não substitui a guardada, nem quando diz `entregue`. Custo: uma entrega corrigida para trás no tempo não muda o status. Supõe `event_id` estável; o mesmo fato com outro id vira dois eventos.
- **Código sem eventos.** Antes do primeiro evento, `status` é `null`. Um `404` do agregador conta como código ainda sem eventos (`200` com `status: null`). Uma URL base errada cai no mesmo caso.
- **Código.** Espaços nas pontas são ignorados em cadastro, sincronização e consulta.
- **Payload malformado.** JSON ilegível, sem `events`, de outro `tracking_code`, evento incompleto ou instante fora do RFC 3339 com offset recusam o payload inteiro (`502`). Nenhum evento some em silêncio. A data é validada à mão porque `Date.parse` aceita formatos frouxos e normaliza datas inexistentes.
- **Tempo limite.** `AbortSignal.timeout(5000)` no `fetch`; cobre também a leitura do corpo.
- **Operações serializadas por código.** Cadastro e sincronização do mesmo código rodam em fila. Uma operação nunca grava por cima da outra.
- **Erros.** O domínio lança erros próprios sem saber de HTTP; `src/app.ts` tem a única tabela erro → status.
- **Persistência em memória.** Processo reiniciado esquece os códigos.

## O que ficou de fora

- SQLite ou outra persistência.
- Aviso externo (e-mail, fila) quando `atrasado` vira `true`. A API só expõe o campo.
- Autenticação, retentativa e webhook do agregador.
- Código sem nenhum evento nunca vira atraso, porque a contagem começa no primeiro evento.
- Não há como desfazer uma entrega registrada por engano.
- Mapa de status configurável em tempo de execução. Cada adaptador carrega o próprio dialeto.

## Com mais tempo

Gravaria o histórico em SQLite, publicaria o atraso num canal e deixaria o dialeto de cada transportadora num arquivo próprio, atrás da mesma porta. Contaria o atraso de códigos sem evento a partir da data de cadastro, tornaria o tempo limite do agregador configurável, validaria corpo e resposta com JSON Schema do Fastify e encerraria o servidor com `app.close()` no `SIGTERM`.

## Uso de IA

**Usei o Claude Code para:**

1. revisar a solução contra o enunciado do desafio e propor melhorias, limpezas conforme as convenções e boas práticas da stack, e confirmar o que ainda faltava para fechar o desafio;
2. comparar a solução com a documentação oficial do Fastify, do Node.js e do MDN (mapeamento de erros, tipagem de rotas, validação por schema, `URL`, `AbortSignal.timeout`, `Error.cause`);
3. aplicar as melhorias com um teste escrito e visto falhando antes de cada mudança (formato único de erro com `setErrorHandler`, causa da falha do agregador, `atrasado` calculado em vez de gravado, montagem da URL do agregador, `noUncheckedIndexedAccess`);
4. ajustar o README às mudanças e fazer uma revisão final em contexto limpo, item a item da entrega e dos critérios de avaliação.

**Revisei pessoalmente:**

1. li a diff de cada arquivo e validei as mudanças;
2. validei as regras de negócio e o sentido delas no desafio: status desconhecido como `excecao`, `entregue` como final, histórico por `event_id` e atraso que não marca entrega normal;
3. avaliei o contrato, a clareza e o escopo do desafio, e decidi o que ficaria de fora (aviso por canal externo, SQLite, validação por JSON Schema);
4. conferi se o exemplo de payload bruto e o status normalizado do README batem com o que a API devolve;
5. rodei `npm test` e `npm run typecheck` e testei a API localmente com o agregador fictício de `examples/` (cadastro, sincronização, consulta, código inexistente e código vazio).
