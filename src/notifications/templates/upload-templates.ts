import { SESClient, CreateTemplateCommand, UpdateTemplateCommand } from '@aws-sdk/client-ses';
import * as fs from 'fs';
import * as path from 'path';

async function uploadTemplate(client: SESClient, jsonFilePath: string) {
  const content = fs.readFileSync(jsonFilePath, 'utf8');
  const parsed = JSON.parse(content);
  const template = parsed.Template;

  try {
    await client.send(new CreateTemplateCommand({ Template: template }));
    console.log(`[CREADA] Plantilla "${template.TemplateName}" creada exitosamente en SES.`);
  } catch (error: any) {
    if (error.name === 'AlreadyExistsException') {
      await client.send(new UpdateTemplateCommand({ Template: template }));
      console.log(`[ACTUALIZADA] Plantilla "${template.TemplateName}" actualizada exitosamente en SES.`);
    } else {
      console.error(`[ERROR] No se pudo procesar la plantilla "${template.TemplateName}":`, error.message);
    }
  }
}

async function main() {
  const region = process.env.AWS_REGION || 'us-east-1';
  console.log(`Conectando a Amazon SES en region: ${region}...`);

  const client = new SESClient({ region });
  const templatesDir = __dirname;

  const files = [
    'order-created-template.json',
    'payment-approved-template.json',
    'payment-declined-template.json',
  ];

  for (const file of files) {
    const filePath = path.join(templatesDir, file);
    if (fs.existsSync(filePath)) {
      await uploadTemplate(client, filePath);
    } else {
      console.warn(`Archivo no encontrado: ${filePath}`);
    }
  }

  console.log('Proceso de carga de plantillas finalizado.');
}

if (require.main === module) {
  main().catch(console.error);
}
