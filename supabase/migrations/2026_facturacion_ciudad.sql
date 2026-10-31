-- Ciudad (código DANE) que se le pone al tercero en Siigo cuando la cédula
-- del beneficiario se expidió en el exterior (consulado): de ahí no sale un
-- municipio colombiano, y la DIAN rechaza el documento soporte sin país.
-- Si no se configura, se usa la ciudad de la empresa (users.company_city).
ALTER TABLE public.facturacion_config ADD COLUMN IF NOT EXISTS ciudad_exterior text;
NOTIFY pgrst, 'reload schema';
