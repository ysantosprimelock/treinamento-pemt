// ===================== CONFIGURAÇÃO DO APP =====================
// URL do projeto Supabase (Project Settings > API). Confira se é a sua.
export const SUPABASE_URL = 'https://curiyfnhzqrpfljnihty.supabase.co';

// Chave PÚBLICA (anon / publishable). Pode ficar no app: as regras do banco protegem os dados.
// NUNCA cole aqui a chave secreta (service_role / secret).
export const SUPABASE_ANON_KEY = 'COLE_AQUI_A_CHAVE_PUBLICA';
// ===============================================================

export const BUCKET = 'treinamentos';
export const MIN_FOTOS = 3;
export const MAX_FOTOS = 6;
// Depois de confirmados pelo servidor, os treinamentos ficam no aparelho por este tempo (cópia de segurança)
export const DIAS_MANTER_ENVIADOS = 7;
