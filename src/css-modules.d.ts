/** CSS-модули: Vite отдаёт мапу «имя класса в исходнике → мангле́нное имя». */
declare module "*.module.css" {
  const classes: Record<string, string>;

  export default classes;
}
