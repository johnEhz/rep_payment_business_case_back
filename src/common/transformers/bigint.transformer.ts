export const bigintTransformer = {
  to: (value: number | null | undefined): number | null | undefined => value,
  from: (value: string | number | null | undefined): number | null | undefined =>
    value !== null && value !== undefined ? Number(value) : value,
};
