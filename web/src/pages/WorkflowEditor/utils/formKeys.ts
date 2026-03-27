import type { CustomSchemaItem } from "./types";

const sanitizeKey = (value?: string) => (value ?? "").trim().replace(/\s+/g, "_");

type FormMeta = {
  id?: string;
  name?: string;
};

export const resolveFormIdentifier = (form?: FormMeta, fallbackIndex = 0) => {
  const byID = sanitizeKey(form?.id);
  if (byID) return byID;
  const byName = sanitizeKey(form?.name);
  if (byName) return byName;
  return `form_${fallbackIndex + 1}`;
};

export const resolveSchemaFieldIdentifier = (schemaItem: CustomSchemaItem, fallbackIndex = 0) => {
  const byName = sanitizeKey(schemaItem?.name);
  if (byName) return byName;
  const byID = sanitizeKey(schemaItem?.id);
  if (byID) return byID;
  return `field_${fallbackIndex + 1}`;
};

export const composeCustomFieldCode = (formIdentifier: string, fieldIdentifier: string) => {
  const formKey = sanitizeKey(formIdentifier) || formIdentifier || "form";
  const fieldKey = sanitizeKey(fieldIdentifier) || fieldIdentifier || "field";
  return `${formKey}_${fieldKey}`;
};
