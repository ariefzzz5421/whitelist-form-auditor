export interface StatusMeaning {
  title: string;
  meaning: string;
  note?: string;
}

const KNOWN_STATUS_MEANINGS: Record<number, StatusMeaning> = {
  200: {
    title: "OK",
    meaning: "The server successfully responded to the request.",
    note: "This does not prove permanent database storage.",
  },
  201: {
    title: "Created",
    meaning: "The server reports that a new resource or record was created.",
    note: "Strong signal of successful creation, but database persistence is still not independently verified.",
  },
  202: {
    title: "Accepted",
    meaning: "The server accepted the request for later processing.",
  },
  204: {
    title: "No Content",
    meaning: "The request was processed successfully without a response body.",
  },
  301: {
    title: "Moved Permanently",
    meaning: "The request was permanently redirected.",
  },
  302: {
    title: "Found / Redirect",
    meaning: "The request was redirected to another URL.",
    note: "This is not necessarily an error. Google Apps Script commonly uses redirects.",
  },
  307: {
    title: "Temporary Redirect",
    meaning: "Temporary redirect while preserving the request method.",
  },
  308: {
    title: "Permanent Redirect",
    meaning: "Permanent redirect while preserving the request method.",
  },
  400: {
    title: "Bad Request",
    meaning: "The server rejected an invalid request.",
  },
  401: {
    title: "Unauthorized",
    meaning: "Authentication is required or failed.",
  },
  403: {
    title: "Forbidden",
    meaning: "The server understood the request but denied access.",
  },
  404: {
    title: "Not Found",
    meaning: "The requested endpoint was not found.",
  },
  429: {
    title: "Too Many Requests",
    meaning: "The service rate limit was reached.",
  },
  500: {
    title: "Internal Server Error",
    meaning: "The target server encountered an internal error.",
  },
  502: {
    title: "Bad Gateway",
    meaning: "A gateway or upstream server failed.",
  },
  503: {
    title: "Service Unavailable",
    meaning: "The server is temporarily unavailable or overloaded.",
  },
  504: {
    title: "Gateway Timeout",
    meaning: "An upstream server did not respond in time.",
  },
};

export function getStatusMeaning(status: number): StatusMeaning {
  const known = KNOWN_STATUS_MEANINGS[status];
  if (known) {
    return known;
  }

  const family = Math.floor(status / 100);
  if (family === 2) {
    return {
      title: "2xx Success",
      meaning: "The server returned a successful response.",
      note: "This does not prove permanent database storage.",
    };
  }
  if (family === 3) {
    return {
      title: "3xx Redirect",
      meaning: "The request was redirected.",
    };
  }
  if (family === 4) {
    return {
      title: "4xx Client Error",
      meaning: "The target server rejected the request.",
    };
  }
  if (family === 5) {
    return {
      title: "5xx Server Error",
      meaning: "The target server or an upstream service failed.",
    };
  }

  return {
    title: "Unknown Status",
    meaning: "The server returned an uncommon HTTP status code.",
  };
}
