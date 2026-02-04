import OpenAI from "openai";
import { z } from "zod";

// the newest OpenAI model is "gpt-4o" which supports vision
// Using gpt-4o for image analysis as it's the current vision-capable model
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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
  link_edital: z.string().optional().default(""),
  link_matricula: z.string().optional().default(""),
});

export type ExtractedAuctionData = z.infer<typeof extractedAuctionDataSchema>;

export async function extractAuctionDataFromImage(base64Image: string): Promise<ExtractedAuctionData> {
  const prompt = `Você é um especialista em extrair dados de páginas de leilão de imóveis no Brasil.

Analise esta imagem de uma página de leilão e extraia TODOS os dados que conseguir identificar.

Retorne um JSON com os seguintes campos (deixe vazio "" se não encontrar):
{
  "nome_do_anuncio": "título ou nome do anúncio do imóvel",
  "descricao": "descrição do imóvel se houver",
  "tipo_do_imovel": "Casa, Apartamento, Terreno, Comercial, Rural ou Outros",
  "tipo_de_leilao": "Judicial, Extrajudicial, Leilão Online, etc",
  "nome_leiloeiro": "nome do leiloeiro se aparecer",
  "area_imovel": "área em m² (apenas números e m²)",
  "valor_avalaiacao_imovel": "valor de avaliação (formato: R$ 000.000,00)",
  "valor_leilao": "valor mínimo ou lance inicial",
  "valor_praca1": "valor da 1ª praça",
  "valor_praca2": "valor da 2ª praça",
  "valor_praca3": "valor da 3ª praça se houver",
  "praca_1": "data/hora da 1ª praça (formato ISO: YYYY-MM-DDTHH:mm)",
  "praca_2": "data/hora da 2ª praça (formato ISO: YYYY-MM-DDTHH:mm)",
  "praca_3": "data/hora da 3ª praça se houver",
  "desconto": "percentual de desconto se mencionado",
  "numero_do_processo": "número do processo judicial se aparecer",
  "cep": "CEP do imóvel",
  "cidade": "cidade do imóvel",
  "estado_uf": "sigla do estado (ex: SP, RJ, MG)",
  "logradouro": "rua/avenida do endereço",
  "bairro": "bairro do imóvel",
  "numero": "número do endereço",
  "link_edital": "URL do edital se visível na página",
  "link_matricula": "URL da matrícula se visível na página"
}

IMPORTANTE: 
- Extraia o máximo de informações possível
- Para datas, converta para formato ISO (YYYY-MM-DDTHH:mm)
- Para valores monetários, mantenha o formato brasileiro (R$ 000.000,00)
- Se um campo não for encontrado, deixe como string vazia ""
- Retorne APENAS o JSON, sem explicações adicionais`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
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
