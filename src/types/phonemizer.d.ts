declare module "phonemizer" {
  export function phonemize(text: string, language?: string): Promise<string | string[]>;
  export function list_voices(language?: string): Promise<
    Array<{
      name: string;
      identifier: string;
      languages: Array<{ priority: number; name: string }>;
    }>
  >;
}
