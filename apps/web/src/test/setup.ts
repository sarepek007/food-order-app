import * as matchers from '@testing-library/jest-dom/matchers';
import { afterAll, afterEach, beforeAll, expect } from 'vitest';
import { server } from './server';

// Матчеры подключаются явно: точка входа jest-dom/vitest завязана
// на конкретную мажорную версию vitest, а этот способ от неё не зависит.
expect.extend(matchers);

// Перехват сети на уровне HTTP: компоненты работают с настоящим fetch,
// поэтому тесты проверяют и клиент, и разбор problem+json.
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
