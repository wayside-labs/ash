import { type Address, address } from "@solana/kit";
import { CliError } from "./errors.js";

export function parseAddress(value: string, flag: string): Address {
  try {
    return address(value);
  } catch (error) {
    throw new CliError(`${flag} is not a valid Solana address: ${value}`, { cause: error });
  }
}
