export class LoginResponseDto {
  access_token: string;
  refresh_token: string;
}

export class UserInfoResponseDto {
  id: string;
  email: string;
  username: string;
  role: string;
}
