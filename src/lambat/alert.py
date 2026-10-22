"""Step 5: a separate, slower clock. Warn hospitals one to two weeks ahead.

Weekly city cases modelled from season and rainfall over the previous one to
four weeks. Compared against a seasonal and a last-week baseline on held-out
years 2017 to 2019. An outbreak week is above the 90th percentile of training
weeks. Report sensitivity, false alerts and lead time.
"""


def seasonal_baseline(weekly_cases):
    raise NotImplementedError


def fit_alert_model(weekly_cases, weekly_rain, lags=(1, 2, 3, 4)):
    raise NotImplementedError
