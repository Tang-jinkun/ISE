import 'dotenv/config';
import { defineConfig } from 'prisma/config';

const connectionString = process.env.DATABASE_URL as string;

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: connectionString,
  },
});
