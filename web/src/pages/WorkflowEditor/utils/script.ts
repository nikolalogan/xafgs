const PLACEHOLDER_REG = /\{\{\s*([a-zA-Z_$][\w.$]*)\s*\}\}/g;

export const transformScriptPlaceholders = (script?: string) => {
  if (!script) return script ?? "";
  return script.replace(PLACEHOLDER_REG, (_, key: string) => `context.params['${key}']`);
};
