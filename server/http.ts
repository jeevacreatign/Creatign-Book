/** An error that the API answers with its status code and message. */
export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
