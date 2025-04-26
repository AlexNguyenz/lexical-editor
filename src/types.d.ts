declare module "htmldiff-js" {
  const htmldiff: {
    default: (oldHtml: string, newHtml: string) => string;
  };
  export = htmldiff;
}
