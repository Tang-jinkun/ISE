import { IsEmail, IsNotEmpty, Length } from 'class-validator';

export class LoginParamsDto {
  @IsEmail()
  email: string;

  @IsNotEmpty()
  @Length(6, 64)
  password: string;
}

export class RegisterParamsDto {
  @IsEmail()
  email: string;

  @IsNotEmpty()
  @Length(2, 32)
  username: string;

  @IsNotEmpty()
  @Length(6, 64)
  password: string;
}
