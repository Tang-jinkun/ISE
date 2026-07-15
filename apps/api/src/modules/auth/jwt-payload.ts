export type TokenType = 'access' | 'refresh';

export interface AuthTokenPayload {
  sub: string;
  username: string;
  tokenType: TokenType;
}
