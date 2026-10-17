"""The single place where "who may do what" is decided.

Permissions are scoped to the team that owns the item. Every endpoint that touches an item calls
`authorize()`; list queries are filtered to `visible_team_ids()` in SQL.
"""

from enum import StrEnum

from app.auth import CurrentUser
from app.errors import forbidden, not_found
from app.models import Role, WorkItem

ROLE_RANK = {Role.VIEWER: 1, Role.MEMBER: 2, Role.LEAD: 3}


class Action(StrEnum):
    VIEW = "view"
    COMMENT = "comment"
    CREATE = "create"
    CLAIM = "claim"
    EDIT = "edit"  # title, description, due date
    CHANGE_PRIORITY = "change_priority"
    ASSIGN = "assign"
    WORK = "work"  # start, submit, resolve, release
    APPROVE = "approve"  # approve, reject
    MANAGE = "manage"  # cancel, close, reopen


def effective_role(user: CurrentUser, team_id: int) -> Role | None:
    """Admins act as a Lead in every team."""
    if user.is_admin:
        return Role.LEAD
    return user.roles.get(team_id)


def has_role(user: CurrentUser, team_id: int, minimum: Role) -> bool:
    role = effective_role(user, team_id)
    return role is not None and ROLE_RANK[role] >= ROLE_RANK[minimum]


def visible_team_ids(user: CurrentUser) -> list[int] | None:
    """Teams whose items the user may see. None means all teams (admin)."""
    return None if user.is_admin else user.team_ids


def can(user: CurrentUser, action: Action, item: WorkItem) -> bool:
    team = item.team_id
    is_assignee = item.assignee_id == user.id
    match action:
        case Action.VIEW | Action.COMMENT:
            return has_role(user, team, Role.VIEWER)
        case Action.CREATE | Action.CLAIM:
            return has_role(user, team, Role.MEMBER)
        case Action.EDIT:
            return has_role(user, team, Role.LEAD) or (
                has_role(user, team, Role.MEMBER) and (is_assignee or item.created_by_id == user.id)
            )
        case Action.CHANGE_PRIORITY | Action.WORK:
            return has_role(user, team, Role.LEAD) or (has_role(user, team, Role.MEMBER) and is_assignee)
        case Action.APPROVE:
            # Four-eyes rule: neither the owner nor whoever submitted the item may approve it, admins included.
            return has_role(user, team, Role.LEAD) and not is_assignee and item.submitted_by_id != user.id
        case Action.ASSIGN | Action.MANAGE:
            return has_role(user, team, Role.LEAD)
    return False


def authorize(user: CurrentUser, action: Action, item: WorkItem) -> None:
    """Raise if the user may not perform `action` on `item`.

    Users outside the owning team get 404 rather than 403, so item ids don't reveal that an item exists.
    """
    if effective_role(user, item.team_id) is None:
        raise not_found()
    if not can(user, action, item):
        raise forbidden()


def authorize_create(user: CurrentUser, team_id: int) -> None:
    if not has_role(user, team_id, Role.MEMBER):
        raise forbidden("You must be a Member or Lead of this team to create items in it")
