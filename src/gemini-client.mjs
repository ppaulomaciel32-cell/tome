const API_ROOT = 'https://generativelanguage.googleapis.com/v1beta';

function required(value, name) {
  if (!value?.trim()) throw new TypeError(`${name} não configurada.`);
  return value.trim();
}

function jsonText(data) {
  const text = data?.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('').trim();
  if (!text) throw Error('Resposta vazia do Gemini.');
  try { return JSON.parse(text); } catch { throw Error('Resposta estruturada inválida do Gemini.'); }
}

function usage(data) {
  const raw = data?.usageMetadata || {};
  return {
    prompt_tokens: raw.promptTokenCount ?? null,
    completion_tokens: raw.candidatesTokenCount ?? null,
    total_tokens: raw.totalTokenCount ?? null,
  };
}

export function createGeminiClient({apiKey, model = 'gemini-flash-latest', embeddingModel = 'gemini-embedding-2', request = fetch, clock = () => Date.now(), onTelemetry = async () => {}}) {
  const key = required(apiKey, 'GEMINI_API_KEY');
  const textModel = required(model, 'GEMINI_MODEL');
  const vectorModel = required(embeddingModel, 'GEMINI_EMBEDDING_MODEL');

  async function invoke(path, body, {itemId = null, stage = 'generation'} = {}) {
    const started = clock(); let response;
    try {
      response = await request(API_ROOT + path, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(60000),
        headers: {'x-goog-api-key': key, 'Content-Type': 'application/json'},
        body: JSON.stringify(body),
      });
      const data = await response.json();
      const tokens = usage(data);
      const telemetry = {
        itemId, stage, provider: 'google-gemini', modelRequested: body.model || textModel,
        modelUsed: data.modelVersion || body.model || textModel, statusHttp: response.status,
        success: response.ok, latencyMs: clock() - started, costUsd: null, ...tokens,
        errorCode: response.ok ? null : (data.error?.status || data.error?.code || `HTTP_${response.status}`),
      };
      await onTelemetry(telemetry);
      if (!response.ok) throw Object.assign(Error(response.status === 429 ? 'Gemini temporariamente ocupado.' : 'Falha na API Gemini.'), {status: response.status, retryable: response.status === 429 || response.status >= 500});
      return {data, telemetry};
    } catch (error) {
      if (!response) await onTelemetry({itemId, stage, provider: 'google-gemini', modelRequested: textModel, statusHttp: null, success: false, latencyMs: clock() - started, errorCode: 'NETWORK_ERROR'});
      throw error;
    }
  }

  async function generateJson({system, prompt, schema, itemId = null, stage = 'generation', maxOutputTokens = 2048}) {
    const body = {
      systemInstruction: {parts: [{text: system}]},
      contents: [{role: 'user', parts: Array.isArray(prompt) ? prompt : [{text: prompt}]}],
      generationConfig: {responseMimeType: 'application/json', responseJsonSchema: schema, maxOutputTokens, temperature: 0.2},
    };
    const {data, telemetry} = await invoke(`/models/${encodeURIComponent(textModel)}:generateContent`, body, {itemId, stage});
    return {output: jsonText(data), telemetry, usage: usage(data), model: data.modelVersion || textModel};
  }

  return {
    generateJson,
    async embeddings(texts, {itemId = null, stage = 'embeddings'} = {}) {
      if (!Array.isArray(texts) || !texts.length || texts.some(text => typeof text !== 'string' || !text.trim())) throw TypeError('Textos de embeddings inválidos.');
      const modelName = `models/${vectorModel}`;
      const requests = texts.map(text => ({model: modelName, content: {parts: [{text}]}, taskType: 'CLUSTERING'}));
      const {data, telemetry} = await invoke(`/models/${encodeURIComponent(vectorModel)}:batchEmbedContents`, {requests}, {itemId, stage});
      const vectors = data.embeddings?.map(row => row.values);
      if (!Array.isArray(vectors) || vectors.length !== texts.length || vectors.some(row => !Array.isArray(row))) throw Error('Resposta de embeddings inválida.');
      return {vectors, telemetry};
    },
  };
}

