"""Dataset Provisioner Service.

Shared provisioning routine for automatically generating dashboards and charts
for any dataset (uploaded DuckDB or connected SQL databases like PostgreSQL).
"""
import logging
from typing import Any, Optional
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Dataset, DatasetColumn, User
from app.uploads.dashboard_generator import generate_dashboard_for_dataset

logger = logging.getLogger("askyourdata.provisioner")


async def provision_dataset_dashboard(
    session: AsyncSession,
    dataset: Dataset,
    user: Optional[User] = None,
) -> Optional[Any]:
    """Generate or refresh dashboard and charts for a dataset.

    Safe wrapper around generate_dashboard_for_dataset:
    Failures are logged and do not block dataset creation.
    """
    try:
        # Ensure dataset columns are loaded
        if not dataset.columns:
            stmt = select(DatasetColumn).where(DatasetColumn.dataset_id == dataset.id)
            res = await session.execute(stmt)
            cols = list(res.scalars().all())
        else:
            cols = list(dataset.columns)

        dashboard = await generate_dashboard_for_dataset(
            session=session,
            dataset=dataset,
            columns=cols,
            user=user,
            filename=dataset.table_name or dataset.name,
        )
        await session.commit()
        logger.info(f"Successfully auto-provisioned dashboard '{dashboard.slug}' for dataset '{dataset.name}'.")
        return dashboard
    except Exception as e:
        logger.error(f"Failed to auto-provision dashboard for dataset '{dataset.name}': {e}", exc_info=True)
        return None
