import test from "node:test";
import assert from "node:assert/strict";
import {
  buildLeilaoPayload,
  cleanAuctionHtmlForExtraction,
  dateForDirectus,
  detectNonRealEstateExtraction,
  getAuctionExtractorConfig,
  getWwwFallbackUrl,
  normalizeAuctionUrl,
  previewAuctionPageExtraction,
} from "./auction-extractor";

test("normalizeAuctionUrl resolves relative URLs and removes tracking params", () => {
  const normalized = normalizeAuctionUrl(
    "/lote/123?utm_source=newsletter&ok=1&fbclid=abc#detalhes",
    "https://www.exemplo.com.br/leiloes",
  );

  assert.equal(normalized, "https://www.exemplo.com.br/lote/123?ok=1");
});

test("getWwwFallbackUrl builds a www retry URL only for naked hosts", () => {
  assert.equal(
    getWwwFallbackUrl("https://hoppeleiloes.com.br/oferta/123?ok=1"),
    "https://www.hoppeleiloes.com.br/oferta/123?ok=1",
  );
  assert.equal(getWwwFallbackUrl("https://www.hoppeleiloes.com.br/oferta/123"), null);
});

test("dateForDirectus normalizes Brazilian auction dates", () => {
  assert.equal(dateForDirectus("20/03/2026 - 16:40"), "2026-03-20 16:40:00");
  assert.equal(dateForDirectus("04/05/2026 11:00:30"), "2026-05-04 11:00:30");
  assert.equal(dateForDirectus("2026-01-10T10:00:00"), "2026-01-10 10:00:00");
});

test("cleanAuctionHtmlForExtraction strips scripts and preserves PDFs and images", () => {
  const cleaned = cleanAuctionHtmlForExtraction(`
    <html>
      <head><script>window.secret = "nope"</script><style>.x{}</style></head>
      <body>
        <h1>Apartamento em leilão</h1>
        <a href="/docs/edital.pdf">Edital</a>
        <img alt="Fachada" src="https://cdn.exemplo.com/img.jpg" />
      </body>
    </html>
  `);

  assert.match(cleaned.text, /Apartamento em leilão/);
  assert.doesNotMatch(cleaned.text, /window\.secret/);
  assert.match(cleaned.text, /\[PDF: Edital\] \(\/docs\/edital\.pdf\)/);
  assert.match(cleaned.text, /\[IMG: Fachada\] \(https:\/\/cdn\.exemplo\.com\/img\.jpg\)/);
  assert.deepEqual(cleaned.pdfUrls, ["/docs/edital.pdf"]);
});

test("buildLeilaoPayload maps extracted fields to Directus payload", () => {
  const output = {
    is_individual_item: true,
    nome_do_anuncio: "Casa 01",
    descricao: "Imóvel residencial",
    area_imovel: "120m²",
    tipo_do_imovel: "Casa",
    tipo_de_leilao: "Judicial",
    nome_leiloeiro: "Leiloeiro Teste",
    numero_do_processo: "0001234-56.2024.8.26.0000",
    valor_avalaiacao_imovel: "R$ 500.000,00",
    valor_leilao: "",
    valor_do_leilao: "R$ 250.000,00",
    valor_praca1: "R$ 300.000,00",
    valor_praca2: "R$ 250.000,00",
    valor_praca3: "",
    desconto: "50%",
    praca_1: "2026-01-10T10:00:00",
    praca_2: "2026-01-20T10:00:00",
    praca_3: "",
    link_edital: "/docs/edital.pdf",
    link_matricula: "https://files.exemplo.com/matricula.pdf",
    cep: "01000-000",
    cidade: "São Paulo",
    estado_uf: "São Paulo",
    bairro: "Centro",
    logradouro: "Rua Teste",
    numero: "10",
    link_imagem: "/img/casa.jpg",
  } as Parameters<typeof buildLeilaoPayload>[0];

  const payload = buildLeilaoPayload(output, "https://leiloes.exemplo.com/lote/123", 42);

  assert.equal(payload.status, "published");
  assert.equal(payload.nome_do_anuncio, "Casa 01");
  assert.equal(payload.valor_leilao, "R$ 250.000,00");
  assert.equal(payload.praca_1, "2026-01-10 10:00:00");
  assert.equal(payload.link_edital, "https://leiloes.exemplo.com/docs/edital.pdf");
  assert.equal(payload.link_imagem, "https://leiloes.exemplo.com/img/casa.jpg");
  assert.equal(payload.estado_uf, "SP");
  assert.equal(payload.link_anuncio, "https://leiloes.exemplo.com/lote/123");
  assert.equal(payload.site, 42);
});

test("detectNonRealEstateExtraction blocks vehicle lots without real estate signals", () => {
  const output = {
    is_individual_item: true,
    nome_do_anuncio: "Sucata aproveitável- VW/FOX 1.0 GII 2010/2011",
    tipo_do_imovel: "",
    area_imovel: "",
    link_matricula: "",
    cep: "",
    logradouro: "",
    bairro: "",
    cidade: "Suzano",
    estado_uf: "SP",
  } as Parameters<typeof detectNonRealEstateExtraction>[0];

  const reason = detectNonRealEstateExtraction(
    output,
    "https://liderleiloes.com.br/eventos/leilao/sucatas/lote/36219/lote",
    "RENAVAM, chassi, placa e veículo em leilão",
  );

  assert.match(reason || "", /veiculo|sucata|imovel/i);
});

test("detectNonRealEstateExtraction does not treat removal address as real estate signal", () => {
  const output = {
    is_individual_item: true,
    nome_do_anuncio: "Um expositor refrigerado vertical",
    descricao: "Expositor refrigerado em funcionamento, localizado para remoção.",
    tipo_do_imovel: "",
    area_imovel: "",
    link_matricula: "",
    cep: "08150-130",
    logradouro: "Rua José Greff Borba",
    numero: "45",
    bairro: "Parque Santa Rita",
    cidade: "São Paulo",
    estado_uf: "SP",
  } as Parameters<typeof detectNonRealEstateExtraction>[0];

  const reason = detectNonRealEstateExtraction(output, "https://liderleiloes.com.br/lote/expositor", "");

  assert.match(reason || "", /nao ser de imovel|imovel/i);
});

test("previewAuctionPageExtraction skips configured out-of-scope hosts", async () => {
  const config = getAuctionExtractorConfig();
  assert.ok(config.skipHosts.includes("venda-imoveis.caixa.gov.br"));

  const result = await previewAuctionPageExtraction(
    "https://venda-imoveis.caixa.gov.br/sistema/detalhe-imovel.asp?hdnimovel=8787715008637",
    4,
  );

  assert.equal(result.outcome, "not_individual");
  assert.equal(result.message, "Dominio fora do escopo deste extrator");
});
