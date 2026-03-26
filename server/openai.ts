import OpenAI from "openai";
import { z } from "zod";
import { getOpenAIApiKey, trackUsage } from "./openai-usage";

function getClient(): OpenAI {
  return new OpenAI({ apiKey: getOpenAIApiKey() });
}

const extractedAuctionDataSchema = z.object({
  nome_do_anuncio: z.string().optional().default(""),
  descricao: z.string().optional().default(""),
  tipo_do_imovel: z.string().optional().default(""),
  tipo_de_leilao: z.string().optional().default(""),
  nome_leiloeiro: z.string().optional().default(""),
  area_imovel: z.string().optional().default(""),
  valor_avalaiacao_imovel: z.string().optional().default(""),
  valor_leilao: z.string().optional().default(""),
  valor_praca1: z.string().optional().default(""),
  valor_praca2: z.string().optional().default(""),
  valor_praca3: z.string().optional().default(""),
  praca_1: z.string().optional().default(""),
  praca_2: z.string().optional().default(""),
  praca_3: z.string().optional().default(""),
  desconto: z.string().optional().default(""),
  numero_do_processo: z.string().optional().default(""),
  cep: z.string().optional().default(""),
  cidade: z.string().optional().default(""),
  estado_uf: z.string().optional().default(""),
  logradouro: z.string().optional().default(""),
  bairro: z.string().optional().default(""),
  numero: z.string().optional().default(""),
});

export type ExtractedAuctionData = z.infer<typeof extractedAuctionDataSchema>;

const prompt = `Você é um especialista em extração de dados de leilões de imóveis no Brasil.
Analise a imagem fornecida e extraia todas as informações relevantes sobre o leilão.

Retorne um JSON com os seguintes campos (use string vazia "" se não encontrar a informação):
- nome_do_anuncio: título ou nome do anúncio do leilão
- descricao: descrição detalhada do imóvel
- tipo_do_imovel: tipo do imóvel (casa, apartamento, terreno, etc.)
- tipo_de_leilao: tipo do leilão (judicial, extrajudicial, etc.)
- nome_leiloeiro: nome do leiloeiro responsável
- area_imovel: área do imóvel em m²
- valor_avalaiacao_imovel: valor de avaliação do imóvel
- valor_leilao: valor do leilão / lance mínimo
- valor_praca1: valor da 1ª praça
- valor_praca2: valor da 2ª praça
- valor_praca3: valor da 3ª praça (se houver)
- praca_1: data e hora da 1ª praça (formato: YYYY-MM-DDTHH:mm)
- praca_2: data e hora da 2ª praça (formato: YYYY-MM-DDTHH:mm)
- praca_3: data e hora da 3ª praça (formato: YYYY-MM-DDTHH:mm, se houver)
- desconto: desconto em relação ao valor de avaliação
- numero_do_processo: número do processo judicial
- cep: CEP do imóvel
- cidade: cidade do imóvel
- estado_uf: estado (UF) do imóvel
- logradouro: endereço/logradouro do imóvel
- bairro: bairro do imóvel
- numero: número do endereço

IMPORTANTE: 
- Extraia o máximo de informações possível
- Para datas, converta para formato ISO (YYYY-MM-DDTHH:mm)
- Para valores monetários, mantenha o formato brasileiro (R$ 000.000,00)
- Se um campo não for encontrado, deixe como string vazia ""
- Retorne APENAS o JSON, sem explicações adicionais`;

export async function extractAuctionDataFromImage(base64Image: string): Promise<ExtractedAuctionData> {
  const model = "gpt-4o";

  try {
    const response = await getClient().chat.completions.create({
      model,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: prompt
            },
            {
              type: "image_url",
              image_url: {
                url: base64Image.startsWith("data:") ? base64Image : `data:image/jpeg;base64,${base64Image}`
              }
            }
          ],
        },
      ],
      max_tokens: 2048,
      response_format: { type: "json_object" },
    });

    if (response.usage) {
      trackUsage(
        model,
        'image_extraction',
        response.usage.prompt_tokens,
        response.usage.completion_tokens,
      );
    }

    const content = response.choices[0].message.content;
    if (!content) {
      throw new Error("No response from OpenAI");
    }

    const parsedJson = JSON.parse(content);
    const validationResult = extractedAuctionDataSchema.safeParse(parsedJson);
    
    if (!validationResult.success) {
      console.error("Validation errors:", validationResult.error.flatten());
      const partialData: ExtractedAuctionData = {};
      for (const key of Object.keys(extractedAuctionDataSchema.shape)) {
        const value = parsedJson[key];
        if (typeof value === "string") {
          (partialData as Record<string, string>)[key] = value;
        }
      }
      return partialData;
    }
    
    return validationResult.data;
  } catch (error) {
    console.error("Error extracting data from image:", error);
    throw new Error(`Falha ao extrair dados da imagem: ${error instanceof Error ? error.message : "Erro desconhecido"}`);
  }
}
