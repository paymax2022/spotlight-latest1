# API Endpoints (Mobile, v1)

> All financial POSTs require idempotency keys + server-side pre-trade checks (see `compliance.md`). Base path `/api/v1`.

## Investment
| Method | Path |
|---|---|
| GET | `/invest/home` |
| GET | `/invest/profile` |
| POST | `/invest/activate` |
| GET | `/invest/eligibility` |
| GET | `/invest/agreements` |
| POST | `/invest/agreements/accept` |

## Suitability
| GET | `/suitability/questions` |
| POST | `/suitability/submit` |
| GET | `/suitability/result` |

## Assets
| GET | `/assets` |
| GET | `/assets/search` |
| GET | `/assets/:id` |
| GET | `/assets/:id/chart` |
| GET | `/assets/:id/news` |
| GET | `/assets/:id/disclosures` |

## Stocks
| GET | `/stocks` |
| GET | `/stocks/:symbol` |
| POST | `/stocks/orders` |
| GET | `/stocks/orders` |
| GET | `/stocks/orders/:id` |
| POST | `/stocks/orders/:id/cancel` |
| GET | `/stocks/public-offers` |
| GET | `/stocks/public-offers/:id` |
| POST | `/stocks/public-offers/:id/apply` |

## Crypto
| GET | `/crypto/assets` |
| GET | `/crypto/assets/:symbol` |
| POST | `/crypto/quote` |
| POST | `/crypto/buy` |
| POST | `/crypto/sell` |
| POST | `/crypto/swap` |
| GET | `/crypto/deposit-address` |
| POST | `/crypto/withdraw` |
| GET | `/crypto/transactions` |

## Portfolio
| GET | `/portfolio` |
| GET | `/portfolio/performance` |
| GET | `/portfolio/positions` |
| GET | `/portfolio/statements` |
| POST | `/portfolio/statements/export` |

## Wallet
| GET | `/invest/wallet` |
| POST | `/invest/wallet/deposit` |
| POST | `/invest/wallet/withdraw` |
| POST | `/invest/wallet/transfer` |
| GET | `/invest/wallet/transactions` |

## Watchlist
| GET | `/watchlists` |
| POST | `/watchlists` |
| PATCH | `/watchlists/:id` |
| DELETE | `/watchlists/:id` |
| POST | `/watchlists/:id/assets` |
| DELETE | `/watchlists/:id/assets/:assetId` |

## Alerts
| GET | `/alerts` |
| POST | `/alerts` |
| PATCH | `/alerts/:id` |
| DELETE | `/alerts/:id` |

## Learn
| GET | `/learn/home` |
| GET | `/learn/paths` |
| GET | `/learn/lessons/:id` |
| POST | `/learn/quizzes/:id/submit` |

## AI Assistant (guardrailed — see `modules.md`)
| POST | `/ai/invest/chat` |
| POST | `/ai/invest/explain-asset` |
| POST | `/ai/invest/explain-order` |
| POST | `/ai/invest/explain-portfolio` |
