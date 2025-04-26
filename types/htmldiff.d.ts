declare module "htmldiff" {
  function diff(oldStr: string, newStr: string): string;
  export { diff as default };
}
