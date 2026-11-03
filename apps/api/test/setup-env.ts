process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://fgone:fgone_dev_pw@localhost:5432/fgone_test?schema=public';
process.env.WEB_ORIGIN = 'http://localhost:3000';
process.env.TRUST_PROXY = '2';
