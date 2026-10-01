"""
Forecasting model candidates (used by train_model.py; loaded by forecast.py and update_model.py).

Every candidate has
    fit(train)                      train: history with the inputs from features.py
    predict(horizon, known_totals)  → hourly total demand (kWh) for the horizon rows
The appliance model also has predict_appliances(horizon) → one column per appliance.
"""

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.linear_model import Ridge
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from xgboost import XGBRegressor

import features as F

TOTAL = F.TOTAL


def xgb(**kw):
    return XGBRegressor(n_estimators=500, max_depth=6, learning_rate=0.05, subsample=0.85, colsample_bytree=0.85,
                        min_child_weight=3, tree_method="hist", n_jobs=4, random_state=0, **kw)


class Candidate:
    """fit(train) on a featured history; predict(horizon, known_totals) → total per hour (and appliances if available)."""
    appliances = False

    def __init__(self, name):
        self.name = name

    def fit(self, train):
        return self

    def predict(self, horizon, known_totals):
        raise NotImplementedError


class SeasonalNaive(Candidate):
    def predict(self, horizon, known_totals):
        return np.asarray(known_totals[-168:][: len(horizon)], dtype=float)


class TotalModel(Candidate):
    def __init__(self, name, estimator):
        super().__init__(name)
        self.estimator = estimator

    def fit(self, train):
        self.estimator.fit(train[F.BASE], train[TOTAL])
        return self

    def predict(self, horizon, known_totals):
        return np.clip(self.estimator.predict(horizon[F.BASE]), 0, None)


class ApplianceModel(Candidate):
    """XGBoost with one output per appliance (native multi-output trees)."""
    appliances = True

    def fit(self, train):
        self.model = xgb().fit(train[F.BASE], train[F.TARGETS])
        return self

    def predict_appliances(self, horizon):
        return np.clip(self.model.predict(horizon[F.BASE]), 0, None)

    def predict(self, horizon, known_totals):
        return self.predict_appliances(horizon).sum(axis=1)


class RecursiveModel(Candidate):
    """XGBoost on the total with lag inputs; forecasts one day at a time (lags ≥ 24 h)."""

    def fit(self, train):
        train = F.add_lags(train.copy(), train[TOTAL].to_numpy()).dropna(subset=F.LAGS)
        self.model = xgb().fit(train[F.BASE + F.LAGS], train[TOTAL])
        return self

    def predict(self, horizon, known_totals):
        series = list(known_totals)
        out = []
        for day in range(0, len(horizon), 24):
            block = horizon.iloc[day: day + 24].copy()
            lagged = F.add_lags(pd.concat([pd.DataFrame(index=range(len(series))), block.reset_index(drop=True)], ignore_index=True),
                                series + [np.nan] * len(block)).iloc[len(series):]
            for col in F.LAGS:
                block[col] = lagged[col].to_numpy()
            pred = np.clip(self.model.predict(block[F.BASE + F.LAGS]), 0, None)
            series += list(pred)
            out += list(pred)
        return np.array(out)


class Ensemble(Candidate):
    def __init__(self, name):
        super().__init__(name)
        self.parts = [TotalModel("hist_gbm", HistGradientBoostingRegressor(max_iter=400, learning_rate=0.05, random_state=0)),
                      ApplianceModel("xgboost_direct")]

    def fit(self, train):
        for p in self.parts:
            p.fit(train)
        return self

    def predict(self, horizon, known_totals):
        return np.mean([p.predict(horizon, known_totals) for p in self.parts], axis=0)


class SequenceModel(Candidate):
    """
    LSTM or GRU (PyTorch). For every hour it reads the last `window` hours of the model inputs
    (weather, planned calendar, time) and predicts that hour's total demand. Like the direct
    models it needs no past demand, so it can forecast all 7 days at once.
    """

    def __init__(self, name, cell, window=24, hidden=64, epochs=30, lr=2e-3, seed=0):
        super().__init__(name)
        self.cell, self.window, self.hidden, self.epochs, self.lr, self.seed = cell, window, hidden, epochs, lr, seed
        self.state = None

    def _net(self):
        import torch

        rnn = {"lstm": torch.nn.LSTM, "gru": torch.nn.GRU}[self.cell]

        class Net(torch.nn.Module):
            def __init__(self, n_in, hidden):
                super().__init__()
                self.rnn = rnn(n_in, hidden, batch_first=True)
                self.head = torch.nn.Sequential(torch.nn.Linear(hidden, 32), torch.nn.ReLU(), torch.nn.Linear(32, 1))

            def forward(self, x):
                out, _ = self.rnn(x)
                return self.head(out[:, -1]).squeeze(-1)

        return Net(len(F.BASE), self.hidden)

    def _windows(self, X):
        import torch

        t = torch.tensor(X, dtype=torch.float32)
        return t.unfold(0, self.window, 1).permute(0, 2, 1)  # (n - window + 1, window, features)

    def fit(self, train):
        import torch

        torch.manual_seed(self.seed)
        X = train[F.BASE].to_numpy(dtype=float)
        self.mean, self.std = X.mean(axis=0), X.std(axis=0) + 1e-6
        y = train[TOTAL].to_numpy(dtype=float)
        self.y_scale = y.std() + 1e-6
        Xs = (X - self.mean) / self.std
        win = self._windows(Xs)
        target = torch.tensor(y[self.window - 1:] / self.y_scale, dtype=torch.float32)
        split = int(len(win) * 0.9)  # last 10 % for early stopping
        net = self._net()
        opt = torch.optim.Adam(net.parameters(), lr=self.lr)
        best, best_state, patience = float("inf"), None, 0
        g = torch.Generator().manual_seed(self.seed)
        for _ in range(self.epochs):
            net.train()
            for idx in torch.randperm(split, generator=g).split(256):
                opt.zero_grad()
                loss = torch.nn.functional.mse_loss(net(win[idx]), target[idx])
                loss.backward()
                opt.step()
            net.eval()
            with torch.no_grad():
                val = torch.nn.functional.mse_loss(net(win[split:]), target[split:]).item()
            if val < best - 1e-4:
                best, best_state, patience = val, {k: v.clone() for k, v in net.state_dict().items()}, 0
            else:
                patience += 1
                if patience >= 4:
                    break
        net.load_state_dict(best_state)
        self.net, self.state = net, best_state
        self.tail = Xs[-(self.window - 1):]  # context for the first forecast hours
        return self

    def predict(self, horizon, known_totals):
        import torch

        if getattr(self, "net", None) is None:
            self.net = self._net()
            self.net.load_state_dict(self.state)
        Xs = (horizon[F.BASE].to_numpy(dtype=float) - self.mean) / self.std
        self.net.eval()
        with torch.no_grad():
            pred = self.net(self._windows(np.vstack([self.tail, Xs]))).numpy() * self.y_scale
        return np.clip(pred, 0, None)

    def __getstate__(self):  # the network is rebuilt from its weights after loading
        state = self.__dict__.copy()
        state.pop("net", None)
        return state


def make(name):
    return {
        "seasonal_naive": lambda: SeasonalNaive(name),
        "ridge": lambda: TotalModel(name, make_pipeline(StandardScaler(), Ridge(alpha=1.0))),
        "hist_gbm": lambda: TotalModel(name, HistGradientBoostingRegressor(max_iter=400, learning_rate=0.05, random_state=0)),
        "xgboost_direct": lambda: ApplianceModel(name),
        "xgboost_recursive": lambda: RecursiveModel(name),
        "ensemble": lambda: Ensemble(name),
        "lstm": lambda: SequenceModel(name, "lstm"),
        "gru": lambda: SequenceModel(name, "gru"),
    }[name]()


class PeakModel:
    """Highest 1-minute power of each hour (kW), as the upper quantile q: "short peaks may reach X kW"."""

    def __init__(self, q=0.9):
        self.q = q

    def fit(self, train):
        self.model = xgb(objective="reg:quantileerror", quantile_alpha=self.q).fit(train[F.BASE], train["peak_kw"])
        return self

    def predict(self, horizon):
        return np.clip(self.model.predict(horizon[F.BASE]), 0, None)
