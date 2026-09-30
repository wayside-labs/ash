---
name: tokyo-weather
description: Morning weather check that decides whether to buy forecast credits.
baseUrl: https://api.weather.example
env:
  WEATHER_API_KEY: ""
tools:
  - name: weather_now
    description: Current conditions for a city.
    url: /v1/current
    headers:
      Authorization: "Bearer {{ENV:WEATHER_API_KEY}}"
    parameters:
      type: object
      properties:
        city: { type: string }
      required: [city]
---
Check Tokyo every morning. If rain probability is above 60%, ask the executor to buy
100 forecast credits through execute_payment, citing the vendor_reference_id.
