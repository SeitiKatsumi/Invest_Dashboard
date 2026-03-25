import OpenAI from 'openai';
import type { ExplorationResult, AnalysisResult, ScrapingConfig, ConfigValidation } from './types.js';
import { validateRegexPatterns, generateId } from './utils.js';

function generateConfigId(domain: string): string {
  const timestamp = Date.now().toString(36);
  const rand = generateId(6);
  return `${timestamp}${rand}`.slice(0, 12);
}

function fixJsonEscapes(text: string): string {
  try {
    JSON.parse(text);
    return text;
  } catch { /* needs fixing */ }

  const fixed = text.replace(/\\(.)/g, (match, char) => {
    if ('"\\bfnrt/u'.includes(char)) return match;
    return '\\\\' + char;
  });

  try {
    JSON.parse(fixed);
    return fixed;
  } catch { /* try extraction */ }

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    const extracted = jsonMatch[0].replace(/\\(.)/g, (match, char) => {
      if ('"\\bfnrt/u'.includes(char)) return match;
      return '\\\\' + char;
    });
    try {
      JSON.parse(extracted);
      return extracted;
    } catch { /* give up */ }
  }

  return fixed;
}

function prepareExplorationSummary(data: ExplorationResult): string {
  const detailUrls = data.detailUrlsFound.slice(0, 50);
  const categoryUrls = data.categoryUrlsFound.slice(0, 20);
  const allLinks = data.allLinksFound.slice(0, 100);

  const summary = {
    pages_explored: data.pagesExplored,
    stats: data.stats,
    detail_urls_found: detailUrls,
    category_urls_found: categoryUrls,
    sample_urls: allLinks,
    pagination_samples: data.paginationSamples.slice(0, 10),
    page_structures: data.data.slice(0, 8).map(page => ({
      url: page.url,
      type: page.type,
      url_patterns: page.links.uniquePatterns.slice(0, 5),
      total_links: page.links.totalLinks,
      pagination: page.pagination.slice(0, 3),
      card_patterns: page.structure.cardPatterns.slice(0, 3),
    })),
  };

  return JSON.stringify(summary, null, 2);
}

function validateConfigAgainstUrls(
  config: ScrapingConfig,
  detailUrls: string[],
  allUrls: string[],
): ConfigValidation {
  const validation: ConfigValidation = {
    detail_urls_tested: detailUrls.length,
    detail_urls_matched: 0,
    all_urls_tested: allUrls.length,
    all_urls_matched: 0,
    coverage_percent: 0,
    warnings: [],
  };

  const allowlist: RegExp[] = [];
  for (const p of config.allowlist_patterns) {
    try { allowlist.push(new RegExp(p, 'i')); } catch { /* skip */ }
  }

  const detailIndicators: RegExp[] = [];
  for (const p of config.detail_page_indicators) {
    try { detailIndicators.push(new RegExp(p, 'i')); } catch { /* skip */ }
  }

  const allPatterns = [...allowlist, ...detailIndicators];

  for (const url of detailUrls) {
    if (allPatterns.some(re => re.test(url))) {
      validation.detail_urls_matched++;
    }
  }

  for (const url of allUrls) {
    if (allowlist.some(re => re.test(url))) {
      validation.all_urls_matched++;
    }
  }

  if (detailUrls.length > 0) {
    validation.coverage_percent = Math.round(
      (validation.detail_urls_matched / detailUrls.length) * 1000
    ) / 10;
  }

  if (validation.coverage_percent < 50 && detailUrls.length > 5) {
    validation.warnings.push(
      `Baixa cobertura: apenas ${validation.coverage_percent}% das URLs de detalhe conhecidas são capturadas pelos patterns`
    );
  }
  if (allowlist.length === 0) {
    validation.warnings.push('Nenhum pattern de allowlist válido gerado');
  }
  if (detailIndicators.length === 0) {
    validation.warnings.push('Nenhum indicador de página de detalhe gerado');
  }

  return validation;
}

const SYSTEM_PROMPT = `Você é um especialista em web scraping. Analise os dados de exploração de um site e gere uma configuração JSON para scraping determinístico.

REGRAS CRÍTICAS PARA REGEX:
1. ESCAPE caracteres especiais: ? deve ser \\\\?, . deve ser \\\\., $ deve ser \\\\$
2. Para querystrings use: \\\\?param= (não ?param=)
3. Use .* para capturar variações de caminho (ex: /eventos/.*lote/\\\\d+)
4. Use [^/]+ para capturar segmentos variáveis (ex: /categoria/[^/]+/item/\\\\d+)
5. NUNCA use padrões muito específicos que não capturam variações

ALLOWLIST - REGRAS DE OURO:
- SEMPRE use padrões GENÉRICOS que capturam TODAS variações
- Exemplo site de leilão: "/eventos/.*lote/\\\\d+" captura:
  - /eventos/leilao/imoveis-veiculos/lote/123
  - /eventos/leilao/imoveis-veiculos-diversos/lote/456
  - /eventos/leilao/veiculos/lote/789
- Use \\\\d+ para IDs numéricos
- Use [^/]+ para categorias variáveis
- ERRADO: /eventos/leilao/imoveis-veiculos/lote/\\\\d+ (muito específico!)
- CERTO: /eventos/.*lote/\\\\d+ (captura todas categorias)

PAGINAÇÃO - OBRIGATÓRIO se detectada:
- Se viu ?page=, ?pagina=, ?p= -> pagination_pattern: "(\\\\?|&)(page|pagina|p)=\\\\d+"
- Se viu /page/2, /pagina/2 -> pagination_pattern: "/page?/\\\\d+"
- NUNCA retorne pagination_pattern: null se pagination_samples não estiver vazio

BLOCKLIST - REGRAS:
- APENAS páginas institucionais FIXAS sem variação
- Use ancoragem: ^https://domain\\\\.com/(quem-somos|contato)/?$
- NÃO bloqueie querystrings ou categorias

Retorne APENAS um JSON válido com a seguinte estrutura:
{
    "allowlist_patterns": ["regex GENÉRICO - use .* e [^/]+ para variações"],
    "blocklist_patterns": ["regex ESPECÍFICO apenas para páginas fixas institucionais"],
    "pagination_pattern": "regex para paginação - OBRIGATÓRIO se detectada",
    "pagination_type": "query_param|path|link_next|load_more|infinite_scroll|null",
    "listing_page_indicators": ["padrões de URL que indicam página de listagem"],
    "detail_page_indicators": ["padrões de URL que indicam página de detalhe/individual com ID numérico"],
    "link_selectors": ["seletores CSS GENÉRICOS - ex: a[href*='/lote/'] ou a[href] - a allowlist filtra"],
    "max_listing_pages": número (mínimo 50, recomendado 200 para sites grandes),
    "max_detail_pages": número (mínimo 500, recomendado 5000 para sites com muitos itens),
    "category_patterns": ["regex para URLs de categorias - permite navegar todas subcategorias"],
    "analysis_notes": "breve explicação das decisões tomadas"
}`;

function buildUserPrompt(
  summary: string,
  domain: string,
  targetDescription: string,
  previousErrors?: {
    scraping_error?: string;
    scraping_error_analysis?: string;
    previous_config?: Record<string, unknown>;
  },
): string {
  let errorContext = '';
  if (previousErrors) {
    const parts: string[] = [];
    if (previousErrors.scraping_error) {
      parts.push(`ERRO ANTERIOR: ${previousErrors.scraping_error}`);
    }
    if (previousErrors.scraping_error_analysis) {
      parts.push(`ANÁLISE DO ERRO: ${previousErrors.scraping_error_analysis}`);
    }
    if (previousErrors.previous_config) {
      parts.push(`CONFIG ANTERIOR (que falhou): ${JSON.stringify(previousErrors.previous_config, null, 2)}`);
    }
    if (parts.length > 0) {
      errorContext = `\n\n## CONTEXTO DE ERROS ANTERIORES (USE PARA MELHORAR A CONFIG)
${parts.join('\n')}

IMPORTANTE: Use este contexto para evitar os mesmos erros. Ajuste os patterns baseado nos problemas identificados.\n`;
    }
  }

  return `Analise os dados de exploração do site e gere configuração para extrair: ${targetDescription}

DADOS DE EXPLORAÇÃO:
${summary}

DOMÍNIO: ${domain}
${errorContext}
INSTRUÇÕES CRÍTICAS - LEIA COM ATENÇÃO:

## 1. ANALISE detail_urls_found PRIMEIRO
Estas são URLs que o sistema detectou como páginas de detalhe/item individual.
Extraia o PADRÃO COMUM entre elas para criar allowlist_patterns.

EXEMPLOS de como generalizar:
- Se viu: /eventos/leilao/imoveis-veiculos/lote/123/apartamento-centro
         /eventos/leilao/imoveis-veiculos-diversos/lote/456/casa-praia
  Pattern: /eventos/.*/lote/\\d+ (usa .* para categorias variáveis)

- Se viu: /imovel/venda/12345/apartamento-copacabana
         /imovel/aluguel/67890/casa-ipanema  
  Pattern: /imovel/[^/]+/\\d+ (usa [^/]+ para segmento variável)

## 2. ALLOWLIST_PATTERNS - REGRA DE OURO
- SEMPRE use padrões GENÉRICOS com .* ou [^/]+
- NUNCA copie categorias específicas das URLs de exemplo
- O pattern deve capturar TODAS variações possíveis, não só as que você viu
- Teste mentalmente: "este pattern capturaria outras categorias do site?"

## 3. DETAIL_PAGE_INDICATORS
- Baseie-se nas detail_urls_found
- Patterns com ID numérico: /lote/\\d+, /imovel/\\d+, /item/\\d+
- Pode incluir slug após ID: /lote/\\d+/[^/]+

## 4. LINK_SELECTORS - SIMPLICIDADE
- Use seletores GENÉRICOS: a[href*="/lote/"], a[href*="/imovel/"]
- OU simplesmente a[href] (a allowlist filtra)
- NUNCA use seletores com categorias específicas

## 5. BLOCKLIST - MÍNIMO NECESSÁRIO
- Apenas páginas institucionais fixas
- NUNCA bloqueie categorias ou paths de navegação

## 6. PAGINAÇÃO
- Se pagination_samples não está vazio, extraia o padrão
- Comum: (\\?|&)(page|pagina|p)=\\d+

Retorne APENAS o JSON, sem explicações adicionais.`;
}

export async function analyzeAndGenerateConfig(
  explorationData: ExplorationResult,
  domain: string,
  openaiApiKey: string,
  options?: {
    model?: string;
    targetDescription?: string;
    previousErrors?: {
      scraping_error?: string;
      scraping_error_analysis?: string;
      previous_config?: Record<string, unknown>;
    };
  },
): Promise<AnalysisResult> {
  const model = options?.model || 'gpt-4o-mini';
  const targetDescription = options?.targetDescription || 'links de imóveis ou propriedades';

  const summary = prepareExplorationSummary(explorationData);
  const userPrompt = buildUserPrompt(summary, domain, targetDescription, options?.previousErrors);

  const client = new OpenAI({ apiKey: openaiApiKey });

  try {
    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.3,
      max_tokens: 2000,
    });

    let responseText = response.choices[0].message.content?.trim() || '';

    if (responseText.startsWith('```')) {
      responseText = responseText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    responseText = fixJsonEscapes(responseText);
    const configData = JSON.parse(responseText);

    const allowlist = validateRegexPatterns(configData.allowlist_patterns || []);
    const blocklist = validateRegexPatterns(configData.blocklist_patterns || []);
    const listingIndicators = validateRegexPatterns(configData.listing_page_indicators || []);
    const detailIndicators = validateRegexPatterns(configData.detail_page_indicators || []);

    const defaultBlocklist = [
      '\\.(jpg|jpeg|png|gif|svg|webp|ico|css|js|woff|woff2|pdf|zip)(\\?|$)',
      '(facebook|twitter|instagram|linkedin|youtube|whatsapp)\\.com',
      '(mailto:|tel:|javascript:|#)',
      '/(login|register|cart|checkout|share)(/|$)',
    ];

    let paginationPattern = configData.pagination_pattern || null;
    if (paginationPattern) {
      const validated = validateRegexPatterns([paginationPattern]);
      paginationPattern = validated.length > 0 ? validated[0] : null;
    }

    const now = new Date().toISOString();
    const config: ScrapingConfig = {
      id: generateConfigId(domain),
      domain,
      allowlist_patterns: allowlist,
      blocklist_patterns: blocklist.length > 0 ? blocklist : defaultBlocklist,
      pagination_pattern: paginationPattern,
      pagination_type: configData.pagination_type || null,
      listing_page_indicators: listingIndicators,
      detail_page_indicators: detailIndicators,
      max_listing_pages: Math.max(configData.max_listing_pages || 200, 50),
      max_detail_pages: Math.max(configData.max_detail_pages || 5000, 500),
      link_selectors: configData.link_selectors || ['a[href]'],
      category_patterns: validateRegexPatterns(configData.category_patterns || []),
      created_at: now,
      updated_at: now,
      analysis_notes: configData.analysis_notes || '',
      tokens_used: response.usage?.total_tokens || 0,
    };

    const detailUrls = explorationData.detailUrlsFound;
    const allUrls = explorationData.allLinksFound;
    const validation = validateConfigAgainstUrls(config, detailUrls, allUrls);

    return {
      success: true,
      config,
      tokens_used: config.tokens_used,
      validation,
      exploration_summary: {
        pages_explored: explorationData.pagesExplored,
        detail_urls_found: detailUrls.length,
        category_urls_found: explorationData.categoryUrlsFound.length,
        total_links_found: allUrls.length,
      },
    };
  } catch (e) {
    if (e instanceof SyntaxError) {
      return {
        success: false,
        error: `Failed to parse AI response as JSON: ${e.message}`,
      };
    }
    return {
      success: false,
      error: `Analysis failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}
